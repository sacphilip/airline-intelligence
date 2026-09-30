// AeroDataBox often never reports an arrival, leaving landed flights "EnRoute" for days. These tests
// pin down the fix for "a flight that arrived yesterday shows ✈️ In the air".
import "./helpers/temp-db.js";
import "./helpers/with-key.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { toRouteFlight, parseFlightNumber, searchFlight } from "../lib/flight-search.js";
import { toDelayFlight } from "../lib/delays.js";
import { settleStatus, toLeg } from "../lib/sources/aerodatabox.js";

const H = 3600000;
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z";
const t = (ms) => ({ utc: iso(ms), local: iso(ms) });

// 6E 6428 TRV→BLR, flown yesterday; the feed still says EnRoute (as seen in the real data).
const yesterday = {
  number: "6E 6428", callSign: "IGO6428", status: "EnRoute", codeshareStatus: "IsOperator", isCargo: false,
  airline: { name: "IndiGo", iata: "6E", icao: "IGO" }, aircraft: { reg: "VT-IJK", modeS: "800ABC", model: "Airbus A320 NEO" },
  departure: { airport: { iata: "TRV" }, scheduledTime: t(NOW - 26 * H), revisedTime: t(NOW - 26 * H + 10 * 60000) },
  arrival: { airport: { iata: "BLR" }, scheduledTime: t(NOW - 25 * H) }
};

describe("settleStatus", () => {
  const sched = { depSched: NOW - 3 * H, depBest: NOW - 3 * H, arrSched: NOW - 2 * H, arrBest: null };

  it("calls a flight landed once it's an hour past its expected arrival", () => {
    assert.deepEqual(settleStatus("EnRoute", sched, NOW), { status: "Arrived", inferred: true });
    assert.deepEqual(settleStatus("Departed", sched, NOW), { status: "Arrived", inferred: true });
  });

  it("leaves flights still within their arrival window alone", () => {
    assert.deepEqual(settleStatus("EnRoute", { ...sched, arrSched: NOW - 30 * 60000 }, NOW), { status: "EnRoute", inferred: false });
  });

  it("allows for a late departure when there's no arrival estimate", () => {
    // Due in 2h ago, but left 2.5h late: expected about 30 min from now.
    assert.equal(settleStatus("EnRoute", { depSched: NOW - 5 * H, depBest: NOW - 2.5 * H, arrSched: NOW - 2 * H }, NOW).status, "EnRoute");
  });

  it("prefers the airline's arrival estimate when there is one", () => {
    assert.equal(settleStatus("Approaching", { arrSched: NOW - 3 * H, arrBest: NOW - 10 * 60000 }, NOW).status, "Approaching");
  });

  it("never touches other statuses", () => {
    for (const s of ["Expected", "Boarding", "Arrived", "Canceled", null]) assert.deepEqual(settleStatus(s, sched, NOW), { status: s, inferred: false });
  });
});

describe("stale statuses through the app", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it("flight search: yesterday's flight is Landed, and today's aircraft isn't attached to it", async () => {
    const calls = [];
    globalThis.fetch = async (url) => {
      const u = String(url);
      calls.push(u);
      if (u.includes("aerodatabox") && u.includes("/flights/number/6E6428")) return Response.json([yesterday]);
      // Today's 6E 6428 is airborne under the same callsign, on the same airframe.
      if (u.includes("api.adsb.lol/v2/")) return Response.json({ ac: [{ hex: "800abc", flight: "IGO6428 ", lat: 12, lon: 77, alt_baro: 30000, gs: 440 }] });
      throw new Error(`unexpected fetch ${u}`);
    };
    const result = await searchFlight(parseFlightNumber("6E 6428"));
    const [leg] = result.legs;
    assert.equal(leg.status, "Arrived");
    assert.equal(leg.statusInferred, true);
    assert.equal(leg.live, null);
    assert.ok(!calls.some((u) => u.includes("adsb.lol/v2/")), "should not look for a live aircraft for a flight outside its time window");
  });

  it("aircraft rotations: a stale leg becomes a presumed landing with no actual arrival time", () => {
    const leg = toLeg(yesterday);
    assert.equal(leg.status, "Arrived");
    assert.equal(leg.statusInferred, true);
    assert.equal(leg.dep.actual, true);
    assert.equal(leg.arr.actual, false);
  });

  it("route search and the arrivals board settle it too", () => {
    const route = toRouteFlight({ ...yesterday, arrival: { ...yesterday.arrival, airport: { iata: "BLR" } } }, "TRV", NOW);
    assert.deepEqual([route.status, route.statusInferred], ["Arrived", true]);
    const arrival = toDelayFlight({ ...yesterday, movement: yesterday.arrival }, "Arrival");
    assert.deepEqual([arrival.status, arrival.statusInferred, arrival.actual], ["Arrived", true, false]);
    // A departures board can't know the arrival time, and "Departed" is correct there.
    const departure = toDelayFlight({ ...yesterday, status: "Departed", movement: yesterday.departure }, "Departure");
    assert.deepEqual([departure.status, departure.statusInferred], ["Departed", false]);
  });
});
