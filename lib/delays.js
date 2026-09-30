// The Delays tab (one airport's arrivals and departures with delays) and the optional background
// collector that records airport boards into the history database.
import { TtlCache } from "./cache.js";
import { COLLECT_AIRPORTS, COLLECT_INTERVAL_HOURS } from "./config.js";
import { record } from "./db.js";
import * as adb from "./sources/aerodatabox.js";

const boardCache = new TtlCache(15 * 60 * 1000);

export function toDelayFlight(f, direction) {
  const m = f.movement ?? {};
  const sched = adb.adbTime(m, "scheduledTime");
  const best = adb.bestTime(m);
  // An arrivals board knows when each flight is due, so a long-overdue "EnRoute" can be settled as
  // landed. A departures board can't tell when the flight arrives, and "Departed" is right there anyway.
  const { status, inferred } = direction === "Arrival"
    ? adb.settleStatus(f.status ?? null, { arrSched: sched, arrBest: best })
    : { status: f.status ?? null, inferred: false };
  const cancelled = adb.CANCELLED_STATUSES.has(status);
  const actual = direction === "Arrival" ? status === "Arrived" && !inferred : adb.DONE_STATUSES.has(status);
  return {
    number: f.number ?? null,
    direction,
    status,
    statusInferred: inferred,
    cargo: Boolean(f.isCargo),
    airline: adb.toAirline(f.airline),
    other: m.airport ? { iata: m.airport.iata ?? null, icao: m.airport.icao ?? null, name: m.airport.shortName ?? m.airport.name ?? null } : null,
    scheduled: sched,
    scheduledLocal: adb.localHHmm(m, "scheduledTime"),
    best: cancelled ? null : best,
    bestLocal: cancelled ? null : adb.bestLocalHHmm(m),
    actual: !cancelled && actual,
    cancelled,
    delayMin: !cancelled && sched != null && best != null ? Math.round((best - sched) / 60000) : null
  };
}

async function fetchBoard(code, window) {
  const board = await adb.airportBoard(code, window);
  const flights = [
    ...board.arrivals.map((f) => toDelayFlight(f, "Arrival")),
    ...board.departures.map((f) => toDelayFlight(f, "Departure"))
  ];
  const airport = { [code.length === 3 ? "iata" : "icao"]: code };
  record(flights.map((f) => ({ ...f, airport, source: "board" })));
  return flights;
}

// Arrivals and departures from 6h ago to 6h ahead: one AeroDataBox call per airport per 15 min.
export async function airportDelays(code) {
  const flights = await boardCache.getOrLoad(code, () => fetchBoard(code, { offsetMinutes: -360, durationMinutes: 720 }));
  return { airport: code, fetchedAt: boardCache.timeOf(code) ?? Date.now(), flights };
}

// Record the last 12 hours at each configured airport, now and every COLLECT_INTERVAL_HOURS.
// A 12-hour look-back catches every flight's final (actual) times as long as the interval is <= 12h.
export function startCollector() {
  if (!COLLECT_AIRPORTS.length) return;
  if (!adb.isConfigured()) {
    console.warn("COLLECT_AIRPORTS is set but AERODATABOX_KEY isn't; not collecting history");
    return;
  }
  const run = async () => {
    for (const code of COLLECT_AIRPORTS) {
      try {
        const flights = await fetchBoard(code, { offsetMinutes: -720, durationMinutes: 720 });
        console.log(`history: recorded ${flights.length} movements at ${code}`);
      } catch (error) {
        console.warn(`history: ${code} failed: ${error.message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1500)); // the free plan allows ~1 request/s
    }
  };
  console.log(`history: collecting ${COLLECT_AIRPORTS.join(", ")} every ${COLLECT_INTERVAL_HOURS}h`);
  run();
  setInterval(run, COLLECT_INTERVAL_HOURS * 3600 * 1000).unref();
}
