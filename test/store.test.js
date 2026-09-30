import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, describe, it } from "node:test";
import { legToMovements, normalizeNumber, openStore } from "../lib/store.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ft-store-"));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
let store;
let n = 0;
beforeEach(() => { store = openStore(path.join(dir, `t${n++}.db`)); });
afterEach(() => store.close()); // Windows can't delete an open database file

const DAY = 24 * 3600000;
const past = Date.parse("2026-09-01T18:00:00Z");
const dep = (number, scheduled, delayMin, extra = {}) => ({
  direction: "Departure", number, scheduled, airport: { iata: "DEL", icao: "VIDP" }, other: { iata: "BLR" },
  airline: { name: "IndiGo", iata: "6E", icao: "IGO" }, best: scheduled + delayMin * 60000, actual: true,
  cancelled: false, delayMin, status: "Departed", source: "test", ...extra
});

describe("store", () => {
  it("normalizes flight numbers", () => {
    assert.equal(normalizeNumber("6e 5321"), "6E5321");
    assert.equal(normalizeNumber(null), null);
  });

  it("keeps one row per movement and refines it", () => {
    store.saveMovements([dep("6E 1", past, 5, { actual: false, status: "Expected" })]);
    store.saveMovements([dep("6E1", past, 25)]);
    assert.equal(store.summary().n, 1);
    assert.deepEqual(store.flightHistory("6E 1"), { observed: 1, delayed: 1, delayedPct: 1, avgDelay: 25, cancelled: 0, since: past });
  });

  it("never overwrites an actual time with a later estimate", () => {
    store.saveMovements([dep("6E 1", past, 30)]);
    store.saveMovements([dep("6E 1", past, 5, { actual: false })]);
    assert.equal(store.flightHistory("6E 1").avgDelay, 30);
  });

  it("summarises a flight's record, counting early flights as zero delay", () => {
    store.saveMovements([
      dep("6E 1", past, 40), dep("6E 1", past + DAY, -10), dep("6E 1", past + 2 * DAY, 20), dep("6E 1", past + 3 * DAY, 0),
      dep("6E 1", past + 4 * DAY, null, { cancelled: true, best: null, actual: false }),
      dep("6E 2", past, 90)
    ]);
    assert.deepEqual(store.flightHistory("6E1"), { observed: 4, delayed: 2, delayedPct: 0.5, avgDelay: 15, cancelled: 1, since: past });
    assert.equal(store.flightHistory("6E 9"), null);
  });

  it("ignores movements that haven't happened yet", () => {
    store.saveMovements([dep("6E 1", Date.now() + DAY, 60, { actual: false })]);
    assert.equal(store.flightHistory("6E 1"), null);
  });

  it("looks at departures from one airport within an hour of a given UTC hour", () => {
    const hour = (h, m = 0) => Date.parse(`2026-09-01T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
    store.saveMovements([
      dep("A 1", hour(17, 10), 30), dep("A 2", hour(18), 0), dep("A 3", hour(19, 50), 20), // 17-19h: counted
      dep("A 4", hour(20, 5), 90), dep("A 5", hour(12), 90),                                 // outside the window
      dep("A 6", hour(18), 90, { airport: { iata: "BOM", icao: "VABB" } })                   // another airport
    ]);
    const h = store.airportHourHistory({ iata: "DEL", icao: "VIDP" }, 18);
    assert.equal(h.observed, 3);
    assert.equal(h.delayedPct, 2 / 3);
    // Wraps around midnight.
    store.saveMovements([dep("B 1", hour(23, 30), 0), dep("B 2", hour(0, 30) + DAY, 60)]);
    assert.equal(store.airportHourHistory({ iata: "DEL" }, 0).observed, 2);
  });

  it("splits a flight leg into its departure and arrival", () => {
    const leg = {
      number: "BA 117", status: "Arrived", cancelled: false, reg: "G-XWBA", airline: { name: "British Airways", iata: "BA", icao: "BAW" },
      dep: { airport: { iata: "LHR" }, sched: past, best: past + 10 * 60000, actual: true },
      arr: { airport: { iata: "JFK" }, sched: past + 8 * 3600000, best: past + 8 * 3600000 - 5 * 60000, actual: true }
    };
    const [d, a] = legToMovements(leg, "test");
    assert.equal(d.direction, "Departure");
    assert.equal(d.airport.iata, "LHR");
    assert.equal(d.other.iata, "JFK");
    assert.equal(d.delayMin, 10);
    assert.equal(a.direction, "Arrival");
    assert.equal(a.delayMin, -5);
    store.saveMovements([d, a]);
    assert.equal(store.summary().n, 2);
  });
});
