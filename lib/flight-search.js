// The Find flight tab: search by flight number ("6E 5321") or by route and date ("BLR" → "DEL").
import { TtlCache } from "./cache.js";
import { record } from "./db.js";
import { legToMovements } from "./store.js";
import * as adb from "./sources/aerodatabox.js";
import { findLive, lookupRoute } from "./sources/adsb.js";
import { icaoCodesForIata, lookupAirline } from "./sources/airlines.js";

// ---------- search by flight number ----------

// "6E 5321", "6E5321", "BA0117", "IGO5321": a 2-character IATA airline code (not two digits) or a
// 3-letter ICAO code, then 1-4 digits and an optional letter suffix. Leading zeros are dropped.
export function parseFlightNumber(input) {
  const s = String(input ?? "").toUpperCase().replace(/[\s-]/g, "");
  const m = s.match(/^([A-Z]{3}|[A-Z0-9]{2})(\d{1,4})([A-Z]?)$/);
  if (!m || /^\d\d$/.test(m[1])) return null;
  const [, airline, digits, suffix] = m;
  const number = `${Number(digits)}${suffix}`;
  return { airline, isIcao: airline.length === 3, number, display: `${airline} ${number}` };
}

const searchCache = new TtlCache(15 * 60 * 1000);

function movement(m) {
  return {
    airport: adb.toAirport(m?.airport),
    scheduled: adb.adbTime(m, "scheduledTime"),
    estimated: adb.bestTime(m), // estimated gate time, or actual once it has happened
    terminal: m?.terminal ?? null,
    checkInDesk: m?.checkInDesk ?? null,
    gate: m?.gate ?? null,
    baggageBelt: m?.baggageBelt ?? null
  };
}

async function searchAeroDataBox(flight, date) {
  const raw = await adb.flights("number", `${flight.airline}${flight.number}`, date);
  record(raw.map(adb.toLeg).flatMap((l) => legToMovements(l, "search")));
  return raw
    .map((f) => ({
      number: f.number ?? flight.display,
      callsign: f.callSign?.replace(/\s+/g, "") || null,
      airline: adb.toAirline(f.airline),
      status: f.status ?? null,
      origin: movement(f.departure),
      destination: movement(f.arrival),
      aircraft: f.aircraft ? { registration: f.aircraft.reg ?? null, model: f.aircraft.model ?? null, hex: f.aircraft.modeS?.toLowerCase() ?? null } : null
    }))
    .sort((a, b) => (a.origin.scheduled ?? 0) - (b.origin.scheduled ?? 0));
}

// Without a schedule source: find the airline's ICAO callsign (6E -> IGO5321) and read the route
// from adsb.lol's route database. Times stay unknown; status comes from the live position.
async function searchAdsbRoute(flight) {
  const icaoCodes = flight.isIcao ? [flight.airline] : (await icaoCodesForIata(flight.airline)).slice(0, 5);
  const routes = await Promise.all(icaoCodes.map((icao) => lookupRoute(`${icao}${flight.number}`).catch(() => null)));
  const i = routes.findIndex(Boolean);
  if (i < 0) return { legs: [], callsign: icaoCodes[0] ? `${icaoCodes[0]}${flight.number}` : null };
  const icao = icaoCodes[i];
  const airline = await lookupAirline(icao);
  const blank = (airport) => ({ airport, scheduled: null, estimated: null, terminal: null, gate: null });
  return {
    callsign: `${icao}${flight.number}`,
    legs: [{
      number: airline?.iata ? `${airline.iata} ${flight.number}` : flight.display,
      callsign: `${icao}${flight.number}`,
      airline,
      status: null,
      origin: blank(routes[i].origin),
      destination: blank(routes[i].destination),
      aircraft: null
    }]
  };
}

async function loadFlightSearch(flight, date) {
  if (adb.isConfigured()) {
    try {
      const legs = await searchAeroDataBox(flight, date);
      if (legs.length) return { source: "aerodatabox", legs, callsign: null };
    } catch (error) {
      console.warn(error.message);
    }
  }
  const { legs, callsign } = await searchAdsbRoute(flight);
  return { source: legs.length ? "adsb.lol" : null, legs, callsign };
}

// date: optional local departure date (YYYY-MM-DD); without it, the flight nearest to now.
export async function searchFlight(flight, date = null) {
  const cached = await searchCache.getOrLoad(`${flight.display}|${date ?? ""}`, () => loadFlightSearch(flight, date));

  // Live position is fetched fresh (adsb.lol responses are cached for seconds, not minutes).
  const { source, callsign } = cached;
  const now = Date.now();
  // Settled per request, not in the cache: a flight long past its arrival is landed, whatever the
  // airline feed last said (it often never reports the arrival).
  const legs = cached.legs.map((leg) => {
    const { status, inferred } = adb.settleStatus(leg.status, {
      depSched: leg.origin.scheduled, depBest: leg.origin.estimated,
      arrSched: leg.destination.scheduled, arrBest: leg.destination.estimated
    }, now);
    return { ...leg, status, statusInferred: inferred, live: null, liveError: null };
  });
  // The leg being flown now: scheduled around now, preferring one the airline says is airborne
  // (its status can also lag the other way, e.g. still "Expected" after take-off). Requiring the
  // time window matters: the same flight number flies every day under the same callsign, so a
  // live aircraft must never be attached to another day's flight.
  const aroundNow = (l) => l.origin.scheduled != null && l.origin.scheduled - 60 * 60000 <= now &&
    now <= (l.destination.estimated ?? l.destination.scheduled ?? l.origin.scheduled + 12 * 3600000) + 60 * 60000;
  const current = source === "aerodatabox"
    ? legs.find((l) => aroundNow(l) && adb.AIRBORNE_STATUSES.has(l.status)) ??
      legs.find((l) => aroundNow(l) && !["Arrived", "Canceled", "CanceledUncertain"].includes(l.status))
    : legs[0];
  if (current) {
    const wanted = current.callsign ?? callsign;
    let { aircraft, error } = await findLive({ hex: current.aircraft?.hex, callsign: wanted });
    // Looked up by airframe, it may still be flying its previous flight.
    if (aircraft?.callsign && wanted && aircraft.callsign !== wanted) aircraft = null;
    current.live = aircraft ?? null;
    current.liveError = error ?? null;
    // No schedule source: the live position is the only status we have. With one, an aircraft seen
    // airborne has departed whatever the airline's feed still says.
    if (aircraft && !current.status) current.status = aircraft.onGround ? "OnGround" : "EnRoute";
    else if (aircraft && !aircraft.onGround && !adb.AIRBORNE_STATUSES.has(current.status)) current.status = "EnRoute";
  }
  return { query: flight.display, source, scheduleAvailable: adb.isConfigured(), legs };
}

// ---------- search by route ----------
// All departures from one airport on one local date (two 12-hour board calls, AeroDataBox's
// maximum window), filtered to one destination. Cached per origin and date, so other destinations
// from the same airport that day cost no extra quota.
const departuresCache = new TtlCache(30 * 60 * 1000); // "BLR|2026-09-30" -> raw departures

function routeEnd(m, airport) {
  return {
    airport,
    scheduled: adb.adbTime(m, "scheduledTime"),
    estimated: adb.bestTime(m),
    scheduledLocal: adb.localHHmm(m, "scheduledTime"),
    estimatedLocal: adb.bestLocalHHmm(m),
    date: adb.localDate(m),
    terminal: m?.terminal ?? null,
    gate: m?.gate ?? null
  };
}

const codeAirport = (code) => ({ [code.length === 3 ? "iata" : "icao"]: code });

export function toRouteFlight(f, originCode, now = Date.now()) {
  const { status, inferred } = adb.settleFlightStatus(f, now);
  const cancelled = adb.CANCELLED_STATUSES.has(status);
  const origin = routeEnd(f.departure ?? {}, codeAirport(originCode));
  const destination = routeEnd(f.arrival ?? {}, adb.toAirport(f.arrival?.airport));
  const delay = (end) => (end.scheduled != null && end.estimated != null ? Math.round((end.estimated - end.scheduled) / 60000) : null);
  // Before take-off the departure delay is what matters; after it, the arrival delay.
  const departed = adb.DONE_STATUSES.has(status);
  const [delayMin, delayOf] = cancelled ? [null, null]
    : departed && delay(destination) != null ? [delay(destination), "arr"]
    : delay(origin) != null ? [delay(origin), "dep"]
    : delay(destination) != null ? [delay(destination), "arr"]
    : [null, null];
  return {
    number: f.number ?? null,
    callsign: f.callSign?.replace(/\s+/g, "") || null,
    airline: adb.toAirline(f.airline),
    status,
    statusInferred: inferred,
    cancelled,
    aircraft: f.aircraft?.model ?? null,
    origin,
    destination,
    durationMin: origin.scheduled != null && destination.scheduled != null ? Math.round((destination.scheduled - origin.scheduled) / 60000) : null,
    delayMin,
    delayOf
  };
}

async function fetchDepartures(from, date) {
  return departuresCache.getOrLoad(`${from}|${date}`, async () => {
    const departures = [];
    // One after the other: the free plan allows about one request per second.
    for (const [start, end] of [["00:00", "11:59"], ["12:00", "23:59"]]) {
      const board = await adb.airportBoardRange(from, `${date}T${start}`, `${date}T${end}`, { direction: "Departure", withLeg: true, withCargo: false });
      departures.push(...board.departures);
    }
    // Board items fetched withLeg leave out the airport being queried; fill it in for the history.
    record(departures.map(adb.toLeg).flatMap((l) => {
      l.dep.airport ??= codeAirport(from);
      return legToMovements(l, "route");
    }));
    return departures;
  });
}

export async function searchRoute(from, to, date) {
  const toField = to.length === 3 ? "iata" : "icao";
  const flights = (await fetchDepartures(from, date))
    .filter((f) => f.arrival?.airport?.[toField] === to)
    .map((f) => toRouteFlight(f, from))
    .filter((f) => f.origin.date === date) // the window is local time, but be exact about the day
    .sort((a, b) => (a.origin.scheduled ?? 0) - (b.origin.scheduled ?? 0));
  return {
    from, to, date,
    destination: flights[0]?.destination.airport ?? null,
    fetchedAt: departuresCache.timeOf(`${from}|${date}`) ?? Date.now(),
    flights
  };
}
