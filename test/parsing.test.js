import "./helpers/temp-db.js"; // first: flight-search.js opens the history database on import
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TtlCache } from "../lib/cache.js";
import { parseFlightNumber } from "../lib/flight-search.js";
import { distanceNm } from "../lib/geo.js";
import { adbTime, toLeg } from "../lib/sources/aerodatabox.js";
import { parseAirlines, parseCsvLine } from "../lib/sources/airlines.js";
import { assessWeather } from "../lib/sources/weather.js";

describe("parseFlightNumber", () => {
  it("accepts IATA and ICAO forms and drops leading zeros", () => {
    assert.deepEqual(parseFlightNumber("6E 5321"), { airline: "6E", isIcao: false, number: "5321", display: "6E 5321" });
    assert.equal(parseFlightNumber("ba0117").display, "BA 117");
    assert.equal(parseFlightNumber("IGO-5321").display, "IGO 5321");
    assert.equal(parseFlightNumber("UAE 1").number, "1");
    assert.equal(parseFlightNumber("DL 1234A").number, "1234A");
  });

  it("rejects things that aren't flight numbers", () => {
    for (const bad of ["", "12 345", "BA", "BA 12345", "B 1", "hello"]) assert.equal(parseFlightNumber(bad), null, bad);
  });
});

describe("airline list", () => {
  it("parses quoted CSV fields", () => {
    assert.deepEqual(parseCsvLine('ACR,"Aerocenter, Escuela ""X""",ACR,,,'), ["ACR", 'Aerocenter, Escuela "X"', "ACR", "", "", ""]);
  });

  it("indexes by ICAO and IATA, keeping every airline that shares an IATA code", () => {
    const csv = "﻿Code,Name,ICAO,IATA\nBAW,British Airways,BAW,BA\nSHT,British Airways Shuttle,SHT,BA\nAHE,\"Airport Helicopter, Muller &amp; Co.\",AHE,\n";
    const { byIcao, byIata } = parseAirlines(csv);
    assert.equal(byIcao.get("BAW").name, "British Airways");
    assert.equal(byIcao.get("AHE").name, "Airport Helicopter, Muller & Co.");
    assert.deepEqual(byIata.get("BA"), ["BAW", "SHT"]);
  });
});

describe("AeroDataBox responses", () => {
  it("reads both time formats", () => {
    assert.equal(adbTime({ scheduledTime: { utc: "2026-09-28 14:30Z" } }, "scheduledTime"), Date.parse("2026-09-28T14:30Z"));
    assert.equal(adbTime({ scheduledTimeUtc: "2026-09-28 14:30Z" }, "scheduledTime"), Date.parse("2026-09-28T14:30Z"));
    assert.equal(adbTime({}, "scheduledTime"), null);
  });

  it("normalizes a flight into a leg, preferring gate times", () => {
    const leg = toLeg({
      number: "BA 117", callSign: "BAW 117", status: "Arrived", aircraft: { reg: "G-XWBA", modeS: "40762F", model: "Airbus A350-1000" },
      airline: { name: "British Airways", iata: "BA", icao: "BAW" },
      departure: { airport: { iata: "LHR", timeZone: "Europe/London", location: { lat: 51.47, lon: -0.45 } }, scheduledTime: { utc: "2026-09-28 10:00Z" }, revisedTime: { utc: "2026-09-28 10:20Z" } },
      arrival: { airport: { iata: "JFK" }, scheduledTime: { utc: "2026-09-28 18:00Z" }, runwayTime: { utc: "2026-09-28 17:50Z" }, revisedTime: { utc: "2026-09-28 18:05Z" } }
    });
    assert.equal(leg.callSign, "BAW117");
    assert.equal(leg.hex, "40762f");
    assert.equal(leg.dep.airport.timeZone, "Europe/London");
    assert.equal(leg.dep.actual, true);
    assert.equal(leg.arr.best, Date.parse("2026-09-28T18:05Z")); // revised (gate) beats runway
    assert.equal(leg.arr.actual, true);
  });

  it("drops times for cancelled flights", () => {
    const leg = toLeg({ number: "X 1", status: "Canceled", departure: { revisedTime: { utc: "2026-09-28 10:20Z" } }, arrival: {} });
    assert.equal(leg.cancelled, true);
    assert.equal(leg.dep.best, null);
  });
});

describe("weather assessment", () => {
  it("flags what disrupts flights, and nothing else", () => {
    assert.equal(assessWeather({ weatherCode: 95 }, "at DEL").severity, 2);
    assert.equal(assessWeather({ weatherCode: 45 }, "at DEL").severity, 1);
    assert.equal(assessWeather({ weatherCode: 1, visibilityM: 800 }, "at DEL").severity, 1);
    assert.equal(assessWeather({ weatherCode: 3, gustKmh: 75 }, "at DEL").severity, 2);
    assert.equal(assessWeather({ weatherCode: 61, gustKmh: 20, visibilityM: 20000 }, "at DEL"), null);
  });
});

describe("TtlCache", () => {
  it("shares one load between concurrent callers and doesn't cache failures", async () => {
    const cache = new TtlCache(60000);
    let calls = 0;
    const load = async () => { calls++; return "value"; };
    const [a, b] = await Promise.all([cache.getOrLoad("k", load), cache.getOrLoad("k", load)]);
    assert.equal(a, "value");
    assert.equal(b, "value");
    assert.equal(calls, 1);
    await assert.rejects(cache.getOrLoad("bad", async () => { throw new Error("boom"); }));
    assert.equal(cache.get("bad"), undefined);
  });
});

describe("distanceNm", () => {
  it("measures great-circle distance", () => {
    const lhrJfk = distanceNm(51.47, -0.4543, 40.6413, -73.7781);
    assert.ok(Math.abs(lhrJfk - 2991) < 10, String(lhrJfk));
  });
});
