import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { locateInChain, minTurnaround, predictChain } from "../lib/predict.js";

const MIN = 60000;
const T0 = Date.parse("2026-09-30T06:00:00Z");
const at = (minutes) => T0 + minutes * MIN;
const airport = (iata) => ({ iata, icao: null, lat: 0, lon: 0, timeZone: "UTC" });

// A leg from `from` to `to`, scheduled to depart/arrive at the given minutes after T0.
function leg(number, from, to, dep, arr, { status = "Expected", depBest = null, arrBest = null, depActual = false, arrActual = false, cancelled = false } = {}) {
  return {
    number, callSign: number.replace(" ", ""), status, cancelled, airline: null, reg: "VT-ABC", model: "Airbus A320",
    dep: { airport: airport(from), sched: at(dep), best: depBest == null ? null : at(depBest), actual: depActual },
    arr: { airport: airport(to), sched: at(arr), best: arrBest == null ? null : at(arrBest), actual: arrActual }
  };
}

// The example day: running later on every sector, currently flying HYD -> DEL 63 min late.
const day = () => [
  leg("6E 1", "BLR", "DEL", 10, 175, { status: "Arrived", depBest: 12, arrBest: 178, depActual: true, arrActual: true }),
  leg("6E 2", "DEL", "BOM", 195, 330, { status: "Arrived", depBest: 222, arrBest: 357, depActual: true, arrActual: true }),
  leg("6E 3", "BOM", "HYD", 400, 490, { status: "Arrived", depBest: 441, arrBest: 531, depActual: true, arrActual: true }),
  leg("6E 4", "HYD", "DEL", 620, 755, { status: "EnRoute", depBest: 683, arrBest: 818, depActual: true }),
  leg("6E 5", "DEL", "BLR", 810, 980)
];

describe("minTurnaround", () => {
  it("uses aircraft size from the ICAO type code or the model name", () => {
    assert.equal(minTurnaround("B77W").minutes, 75);
    assert.equal(minTurnaround(null, "Boeing 787-9").minutes, 75);
    assert.equal(minTurnaround("AT76").minutes, 25);
    assert.equal(minTurnaround("A20N").minutes, 35);
    assert.equal(minTurnaround(null, null).kind, "narrow-body");
  });
});

describe("locateInChain", () => {
  it("finds the airborne leg by callsign", () => {
    assert.deepEqual(locateInChain(day(), { callsign: "6E4", onGround: false, now: at(700) }), { currentIndex: 3, lastArrivedIndex: 2 });
  });

  it("falls back to the airline's airborne status when the callsign doesn't match", () => {
    assert.equal(locateInChain(day(), { callsign: "XXX1", onGround: false, now: at(700) }).currentIndex, 3);
  });

  it("on the ground, points at the last leg that arrived", () => {
    const legs = day();
    legs[3] = { ...legs[3], status: "Arrived", arr: { ...legs[3].arr, actual: true } };
    assert.deepEqual(locateInChain(legs, { callsign: "6E4", onGround: true, now: at(830) }), { currentIndex: -1, lastArrivedIndex: 3 });
  });
});

describe("predictChain", () => {
  it("propagates the inbound delay minus the turnaround slack", async () => {
    const { legs, predictions } = await predictChain(day(), { currentIndex: 3, lastArrivedIndex: 2, typeCode: "A320" });
    assert.deepEqual(legs.map((l) => l.state), ["done", "done", "done", "current", "upcoming"]);
    assert.equal(legs[3].arrDelay, 63);
    // Scheduled turnaround 810 - 755 = 55 min; an A320 needs ~35, so 20 min can be absorbed: 63 - 20 = 43.
    const [next] = predictions;
    assert.equal(next.index, 4);
    assert.equal(next.depDelay, 43);
    assert.equal(next.level, "moderate");
    assert.deepEqual(next.window, [38, 53]);
    assert.equal(next.expectedDep[0], at(810 + 38));
    assert.ok(next.reasons.some((r) => r.kind === "inbound" && r.text.includes("+63 min late")));
    assert.ok(next.reasons.some((r) => r.kind === "turnaround" && r.text.includes("up to 20 min")));
    assert.ok(next.reasons.some((r) => r.kind === "rotation" && r.text.includes("5th flight")));
  });

  it("uses our position-based estimate only when the airline has no arrival time", async () => {
    const legs = day();
    legs[3].arr.best = null;
    const { legs: described, predictions } = await predictChain(legs, { currentIndex: 3, lastArrivedIndex: 2, liveArrDelay: 30 });
    assert.equal(described[3].arrDelay, 30);
    assert.equal(described[3].arrSource, "position");
    assert.equal(predictions[0].depDelay, 10); // 30 - 20 min slack
    assert.equal(predictions[0].level, "low");
  });

  it("an early inbound doesn't make the next flight early", async () => {
    const legs = day();
    legs[3].arr.best = at(740); // 15 min early
    const { predictions } = await predictChain(legs, { currentIndex: 3, lastArrivedIndex: 2 });
    assert.equal(predictions[0].depDelay, 0);
    assert.equal(predictions[0].level, "low");
  });

  it("takes the airline's later departure estimate over the knock-on delay", async () => {
    const legs = day();
    legs[4].dep.best = at(810 + 70);
    const { predictions } = await predictChain(legs, { currentIndex: 3, lastArrivedIndex: 2 });
    assert.equal(predictions[0].depDelay, 70);
    assert.equal(predictions[0].level, "high");
    assert.ok(predictions[0].reasons.some((r) => r.kind === "airline"));
  });

  it("severe weather raises the level and widens the window, without moving the estimate", async () => {
    const weatherAt = async (ap) => (ap.iata === "BLR" ? { severity: 2, text: "Thunderstorms forecast at BLR" } : null);
    const { predictions } = await predictChain(day(), { currentIndex: 3, lastArrivedIndex: 2 }, { weatherAt });
    assert.equal(predictions[0].depDelay, 43);
    assert.equal(predictions[0].level, "high");
    assert.deepEqual(predictions[0].window, [38, 73]);
    assert.ok(predictions[0].reasons.some((r) => r.kind === "weather"));
  });

  it("mentions recorded history only with enough observations", async () => {
    const make = (observed) => ({
      flightHistory: () => ({ observed, delayed: 4, delayedPct: 0.6, avgDelay: 20, cancelled: 0 }),
      airportHourHistory: () => null
    });
    const few = await predictChain(day(), { currentIndex: 3, lastArrivedIndex: 2 }, { history: make(4) });
    assert.ok(!few.predictions[0].reasons.some((r) => r.kind === "history"));
    const enough = await predictChain(day(), { currentIndex: 3, lastArrivedIndex: 2 }, { history: make(10) });
    assert.ok(enough.predictions[0].reasons.some((r) => r.kind === "history" && r.text.includes("60% of 10")));
  });

  it("chains predictions through later legs, with growing uncertainty", async () => {
    const legs = [...day(), leg("6E 6", "BLR", "DEL", 1020, 1185)]; // 40 min turnaround at BLR: 5 min slack
    const { predictions } = await predictChain(legs, { currentIndex: 3, lastArrivedIndex: 2 });
    assert.equal(predictions.length, 2);
    assert.equal(predictions[1].depDelay, 38); // 43 carried through, minus 5 min slack
    assert.ok(predictions[1].window[1] - predictions[1].depDelay > predictions[0].window[1] - predictions[0].depDelay);
  });

  it("predicts nothing when the aircraft has no flights left today", async () => {
    const legs = day().slice(0, 4);
    const { predictions } = await predictChain(legs, { currentIndex: 3, lastArrivedIndex: 2 });
    assert.deepEqual(predictions, []);
  });
});
