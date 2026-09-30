// Everything the map's detail panel shows about one selected aircraft: its route, STA/ETA and,
// with an AeroDataBox key, its whole day of flights with delay predictions for the ones to come.
import { TtlCache } from "./cache.js";
import { history, record } from "./db.js";
import { distanceNm } from "./geo.js";
import { locateInChain, minutesBetween, predictChain } from "./predict.js";
import { legToMovements } from "./store.js";
import * as adb from "./sources/aerodatabox.js";
import { lookupRoute } from "./sources/adsb.js";
import { lookupAirline } from "./sources/airlines.js";
import { weatherAt } from "./sources/weather.js";

// One AeroDataBox call per aircraft per 15 minutes, however often the page asks.
const scheduleCache = new TtlCache(15 * 60 * 1000);

// Airline callsigns are a 3-letter ICAO code plus a flight number (BAW117, EIN3YR).
const callsignAirline = (callsign) => callsign?.match(/^([A-Z]{3})\d/)?.[1] ?? null;
const byDeparture = (a, b) => (a.dep.sched ?? a.arr.sched ?? 0) - (b.dep.sched ?? b.arr.sched ?? 0);

// The schedule data we can get for this aircraft, in order of preference:
//   day:    all of today's flights for the airframe (AeroDataBox, by ICAO 24-bit address)
//   flight: flights with this callsign on the nearest date (AeroDataBox; not necessarily this airframe)
//   route:  origin and destination only (adsb.lol's route database, no key needed)
async function loadSchedule(hex, callsign) {
  if (adb.isConfigured()) {
    try {
      const byAirframe = hex && !hex.startsWith("~") ? (await adb.flights("icao24", hex)).map(adb.toLeg) : [];
      if (byAirframe.length) {
        const legs = byAirframe.sort(byDeparture);
        record(legs.flatMap((l) => legToMovements(l, "aircraft")));
        return { kind: "day", legs };
      }
      const byCallsign = callsign ? (await adb.flights("callsign", callsign)).map(adb.toLeg) : [];
      if (byCallsign.length) {
        record(byCallsign.flatMap((l) => legToMovements(l, "flight")));
        return { kind: "flight", legs: byCallsign.sort(byDeparture) };
      }
    } catch (error) {
      console.warn(error.message);
    }
  }
  try {
    const route = await lookupRoute(callsign);
    return route ? { kind: "route", route } : { kind: "none" };
  } catch (error) {
    console.warn(error.message);
    return { kind: "none" };
  }
}

// The leg to show as "this flight": the one with this callsign, else the one being flown, else
// the next one to fly, else the last one flown.
function pickFlight(legs, callsign, position) {
  const byCallsign = legs.map((l, i) => [l, i]).filter(([l]) => callsign && l.callSign === callsign);
  if (byCallsign.length) {
    const open = byCallsign.find(([l]) => l.status !== "Arrived" && !l.cancelled);
    return (open ?? byCallsign[byCallsign.length - 1])[1];
  }
  if (position.currentIndex >= 0) return position.currentIndex;
  const next = legs.findIndex((l, i) => i > position.lastArrivedIndex && !l.cancelled);
  return next >= 0 ? next : position.lastArrivedIndex;
}

// For a callsign search: the latest flight that has departed or is about to.
function latestStarted(legs, now = Date.now()) {
  const dep = (l) => l.dep.best ?? l.dep.sched ?? 0;
  return legs.filter((l) => dep(l) <= now + 30 * 60000).sort((a, b) => dep(b) - dep(a))[0] ?? legs[0];
}

function flightFields(leg) {
  return {
    number: leg.number,
    airline: leg.airline,
    status: leg.status,
    origin: leg.dep.airport,
    destination: leg.arr.airport,
    sta: leg.arr.sched,
    // Gate times first (what STA refers to); these become actual times once landed.
    eta: leg.cancelled ? null : leg.arr.best
  };
}

// Our own arrival-delay estimate for a flight in the air: distance to go at current ground speed.
function positionArrivalDelay(leg, live) {
  const dest = leg.arr.airport;
  if (!live || live.onGround || !(live.groundSpeed > 50) || dest?.lat == null || leg.arr.sched == null) return null;
  const eta = Date.now() + (distanceNm(live.lat, live.lon, dest.lat, dest.lon) / live.groundSpeed) * 3600000;
  return minutesBetween(eta, leg.arr.sched);
}

// live: { lat, lon, groundSpeed, onGround, type } from the map, used for ETA and turnaround estimates.
export async function lookupAircraft({ hex, callsign, live = null }) {
  const schedule = await scheduleCache.getOrLoad(hex || callsign, () => loadSchedule(hex, callsign));
  const result = { source: null, scheduleAvailable: adb.isConfigured(), chain: null, aircraft: null };

  if (schedule.kind === "day") {
    const { legs } = schedule;
    const position = locateInChain(legs, { callsign, onGround: live?.onGround ?? false });
    const flightIndex = pickFlight(legs, callsign, position);
    const current = position.currentIndex >= 0 ? legs[position.currentIndex] : null;
    const chain = await predictChain(legs, {
      ...position,
      liveArrDelay: current && current.arr.best == null ? positionArrivalDelay(current, live) : null,
      typeCode: live?.type ?? null
    }, { weatherAt, history });
    Object.assign(result, flightIndex >= 0 ? flightFields(legs[flightIndex]) : {}, {
      source: "aerodatabox",
      aircraft: { reg: legs.find((l) => l.reg)?.reg ?? null, model: legs.find((l) => l.model)?.model ?? null },
      chain: { ...chain, flightIndex }
    });
  } else if (schedule.kind === "flight") {
    Object.assign(result, flightFields(latestStarted(schedule.legs)), { source: "aerodatabox" });
  } else if (schedule.kind === "route") {
    const { route } = schedule;
    Object.assign(result, { source: "adsb.lol", origin: route.origin, destination: route.destination, sta: null, eta: null });
    result.airline = await lookupAirline(route.airlineCode ?? callsignAirline(callsign));
    if (result.airline?.iata && route.routeNumber) result.number = `${result.airline.iata} ${route.routeNumber}`;
  }

  result.airline ??= await lookupAirline(callsignAirline(callsign));
  return result;
}
