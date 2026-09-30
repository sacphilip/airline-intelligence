import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { flightStatus, flightTimeline, fmtDelayMinutes } from "../public/js/flight-status.js";

const T = Date.parse("2026-09-30T02:00:00Z"); // 07:30 in Bengaluru
const min = 60000;
const leg = (status, { dep = null, arr = null, liveError = null } = {}) => ({
  status, liveError,
  origin: { scheduled: T, estimated: dep == null ? null : T + dep * min },
  destination: { scheduled: T + 165 * min, estimated: arr == null ? null : T + (165 + arr) * min }
});
const pick = ({ icon, text, tone, detail }) => ({ icon, text, tone, detail });

describe("flightStatus", () => {
  it("US-003 example: 6E 5321 due 07:30, estimated 07:47 → 🟠 Delayed, +17 min", () => {
    const s = flightStatus(leg("Expected", { dep: 17 }));
    assert.deepEqual(pick(s), { icon: "🟠", text: "Delayed", tone: "warn", detail: null });
    assert.equal(s.depDelay, 17);
    assert.equal(fmtDelayMinutes(s.depDelay), "+17 min");
  });

  it("is on time below the 15-minute threshold", () => {
    assert.deepEqual(pick(flightStatus(leg("Expected", { dep: 14 }))), { icon: "🟢", text: "On time", tone: "good", detail: null });
    assert.equal(flightStatus(leg("Expected")).text, "Scheduled"); // no estimate published yet
  });

  it("escalates to red at an hour late, keeping the airline's stage as detail", () => {
    assert.deepEqual(pick(flightStatus(leg("Boarding", { dep: 75 }))), { icon: "🔴", text: "Delayed", tone: "bad", detail: "Boarding" });
    assert.deepEqual(pick(flightStatus(leg("Boarding", { dep: 3 }))), { icon: "🟢", text: "Boarding", tone: "good", detail: null });
  });

  it("trusts the airline's Delayed status even without a time", () => {
    assert.equal(flightStatus(leg("Delayed")).text, "Delayed");
  });

  it("describes flights in the air and landed by their arrival", () => {
    assert.deepEqual(pick(flightStatus(leg("EnRoute", { dep: 20, arr: 18 }))), { icon: "✈️", text: "In the air", tone: "live", detail: "Running late" });
    assert.equal(flightStatus(leg("Arrived", { dep: 20, arr: 5 })).text, "Landed");
    assert.deepEqual(pick(flightStatus(leg("Arrived", { dep: 40, arr: 32 }))), { icon: "🟠", text: "Landed late", tone: "warn", detail: null });
  });

  it("flags cancellations and diversions", () => {
    for (const [s, text] of [["Canceled", "Cancelled"], ["CanceledUncertain", "Possibly cancelled"], ["Diverted", "Diverted"]]) {
      assert.deepEqual(pick(flightStatus(leg(s))), { icon: "🔴", text, tone: "bad", detail: null });
    }
  });

  it("says when there's no status at all", () => {
    assert.equal(flightStatus(leg(null)).text, "Not currently tracked");
    assert.equal(flightStatus(leg(null, { liveError: "rate limited" })).text, "Live status unavailable");
    assert.equal(flightStatus(leg("OnGround")).text, "On the ground");
  });
});

describe("fmtDelayMinutes", () => {
  it("formats minutes, hours and early departures", () => {
    assert.deepEqual([17, 63, 125, 0, -5, null].map(fmtDelayMinutes), ["+17 min", "+1 h 03 min", "+2 h 05 min", "On time", "-5 min", "–"]);
  });
});

describe("flightTimeline", () => {
  const states = (l) => flightTimeline(l).map((s) => s.state);
  const withDetails = (l) => ({
    ...l,
    origin: { ...l.origin, terminal: "1", checkInDesk: "20-24", gate: "12", airport: { timeZone: "Asia/Kolkata" } },
    destination: { ...l.destination, terminal: "1D", baggageBelt: "5", airport: { timeZone: "Asia/Kolkata" } }
  });

  it("lists the six stages from the story, in order", () => {
    assert.deepEqual(flightTimeline(leg("Expected")).map((s) => s.label), ["Scheduled", "Check-in", "Boarding", "Gate", "Departure", "Arrival"]);
  });

  it("marks stages done, current and upcoming from the airline status", () => {
    assert.deepEqual(states(leg("Expected")), ["current", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming"]);
    assert.deepEqual(states(leg("CheckIn")), ["done", "current", "upcoming", "upcoming", "upcoming", "upcoming"]);
    assert.deepEqual(states(leg("Boarding")), ["done", "done", "current", "upcoming", "upcoming", "upcoming"]);
    assert.deepEqual(states(leg("GateClosed")), ["done", "done", "done", "current", "upcoming", "upcoming"]);
    assert.deepEqual(states(leg("Arrived", { dep: 5, arr: 2 })), ["done", "done", "done", "done", "done", "done"]);
  });

  it("in the air: departure done, arrival in progress with its estimate", () => {
    const steps = flightTimeline(withDetails(leg("EnRoute", { dep: 20, arr: 15 })));
    assert.deepEqual(steps.map((s) => s.state), ["done", "done", "done", "done", "done", "current"]);
    assert.deepEqual([steps[4].timeKind, steps[4].delay], ["actual", 20]);
    assert.deepEqual([steps[5].timeKind, steps[5].delay, steps[5].detail], ["est", 15, "In the air · Terminal 1D · Belt 5"]);
  });

  it("carries desk, gate and times where the airline gives them, and nothing invented", () => {
    const steps = flightTimeline(withDetails(leg("Boarding", { dep: 17 })));
    assert.equal(steps[1].detail, "Terminal 1 · Desk 20-24");
    assert.equal(steps[2].detail, "Gate 12");
    assert.equal(steps[3].detail, "Gate 12");
    assert.deepEqual(steps.slice(1, 4).map((s) => s.time), [null, null, null]); // no check-in/boarding timestamps exist
    assert.deepEqual([steps[4].time, steps[4].timeKind, steps[4].delay], [T + 17 * min, "est", 17]);
    assert.equal(flightTimeline(withDetails(leg("GateClosed"))).at(3).detail, "Gate 12 closed");
  });

  it("shows cancellations and diversions", () => {
    assert.deepEqual(states(leg("Canceled")), ["done", "cancelled", "cancelled", "cancelled", "cancelled", "cancelled"]);
    assert.equal(flightTimeline(leg("Canceled"))[1].detail, "Flight cancelled");
    const diverted = flightTimeline(leg("Diverted", { dep: 0 }));
    assert.deepEqual(diverted.map((s) => s.state), ["done", "done", "done", "done", "done", "diverted"]);
    assert.equal(diverted[5].detail, "Diverted");
  });

  it("doesn't guess a stage when there is no airline status", () => {
    assert.deepEqual(new Set(states(leg(null))), new Set(["unknown"]));
    assert.deepEqual(new Set(states(leg("OnGround"))), new Set(["unknown"]));
  });
});

describe("presumed landings", () => {
  it("shows Landed, but says the arrival time wasn't reported and keeps it an estimate", () => {
    const l = { ...leg("Arrived", { dep: 10, arr: 20 }), statusInferred: true };
    assert.deepEqual(pick(flightStatus(l)), { icon: "🟢", text: "Landed", tone: "good", detail: "Arrival time not reported" });
    const arrival = flightTimeline(l).at(5);
    assert.deepEqual([arrival.state, arrival.timeKind, arrival.detail], ["done", "est", "Landing time not reported"]);
  });
});
