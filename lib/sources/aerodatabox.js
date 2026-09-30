// AeroDataBox (via RapidAPI): schedules, live status and airport boards.
// Every call spends monthly quota, so callers cache results; see the TTLs where it's used.
import { AERODATABOX_KEY } from "../config.js";
import { HttpError } from "../http.js";

const HOST = "aerodatabox.p.rapidapi.com";

export const isConfigured = () => Boolean(AERODATABOX_KEY);

export const DONE_STATUSES = new Set(["Departed", "EnRoute", "Approaching", "Arrived"]);
export const AIRBORNE_STATUSES = new Set(["Departed", "EnRoute", "Approaching"]);
export const CANCELLED_STATUSES = new Set(["Canceled", "CanceledUncertain"]);

// `onStatus` maps an HTTP status to a function returning either an Error to throw or a value to return.
async function request(path, params, onStatus = {}) {
  const response = await fetch(`https://${HOST}${path}${params ? `?${new URLSearchParams(params)}` : ""}`, {
    headers: { "X-RapidAPI-Key": AERODATABOX_KEY, "X-RapidAPI-Host": HOST }
  });
  if (response.status === 204) return null;
  if (onStatus[response.status]) {
    const outcome = onStatus[response.status]();
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }
  if (response.status === 429) throw new HttpError(503, "AeroDataBox quota or rate limit reached, try again later");
  if (!response.ok) throw new Error(`AeroDataBox request failed (${response.status})`);
  return response.json();
}

// ---------- response helpers ----------

// Times look like "2026-09-28 14:30Z"; older responses use *Utc string fields.
export function adbTime(movement, field) {
  const utc = movement?.[field]?.utc ?? movement?.[`${field}Utc`];
  const ms = utc ? Date.parse(utc.replace(" ", "T")) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

// Gate times are what the schedule refers to, so prefer revised (estimated/actual gate) times.
export const bestTime = (m) => adbTime(m, "revisedTime") ?? adbTime(m, "runwayTime") ?? adbTime(m, "predictedTime");

// AeroDataBox often never receives an arrival update (it depends on how well each airport is
// covered), so a flight can stay "Departed" or "EnRoute" for days after landing. Once a flight is
// well past its expected arrival, report it as landed, flagged as inferred: its arrival time is
// still only an estimate. Returns { status, inferred }.
const LANDED_GRACE_MS = 60 * 60000;

export function settleStatus(status, { depSched = null, depBest = null, arrSched = null, arrBest = null }, now = Date.now()) {
  if (!AIRBORNE_STATUSES.has(status)) return { status, inferred: false };
  // Without an arrival estimate, assume it arrives as late as it left.
  const depDelay = depSched != null && depBest != null ? Math.max(0, depBest - depSched) : 0;
  const expectedArrival = arrBest ?? (arrSched == null ? null : arrSched + depDelay);
  if (expectedArrival != null && now > expectedArrival + LANDED_GRACE_MS) return { status: "Arrived", inferred: true };
  return { status, inferred: false };
}

// The same, for a raw /flights/... result (or a board item fetched withLeg).
export const settleFlightStatus = (f, now = Date.now()) => settleStatus(f.status ?? null, {
  depSched: adbTime(f.departure, "scheduledTime"),
  depBest: bestTime(f.departure),
  arrSched: adbTime(f.arrival, "scheduledTime"),
  arrBest: bestTime(f.arrival)
}, now);

// "HH:mm" and "YYYY-MM-DD" in the airport's own time zone, straight from the local timestamp.
export const localHHmm = (m, field) => m?.[field]?.local?.slice(11, 16) ?? null;
export const bestLocalHHmm = (m) => localHHmm(m, "revisedTime") ?? localHHmm(m, "runwayTime") ?? localHHmm(m, "predictedTime");
export const localDate = (m) => m?.scheduledTime?.local?.slice(0, 10) ?? null;

export function toAirport(ap) {
  if (!ap) return null;
  return {
    iata: ap.iata ?? null,
    icao: ap.icao ?? null,
    name: ap.shortName ?? ap.name ?? null,
    city: ap.municipalityName ?? null,
    lat: ap.location?.lat ?? null,
    lon: ap.location?.lon ?? null,
    timeZone: ap.timeZone ?? null
  };
}

export const toAirline = (a) => (a?.name ? { name: a.name, iata: a.iata ?? null, icao: a.icao ?? null } : null);

// One flight leg in a uniform shape, from a /flights/... result or a FIDS item fetched withLeg.
export function toLeg(f) {
  const { status, inferred } = settleFlightStatus(f);
  const cancelled = CANCELLED_STATUSES.has(status);
  const end = (m, happened) => ({
    airport: toAirport(m?.airport),
    sched: adbTime(m, "scheduledTime"),
    best: cancelled ? null : bestTime(m),
    actual: !cancelled && happened,
    terminal: m?.terminal ?? null,
    gate: m?.gate ?? null
  });
  return {
    number: f.number ?? null,
    callSign: f.callSign?.replace(/\s+/g, "").toUpperCase() || null,
    status,
    statusInferred: inferred,
    cancelled,
    airline: toAirline(f.airline),
    reg: f.aircraft?.reg ?? null,
    model: f.aircraft?.model ?? null,
    hex: f.aircraft?.modeS?.toLowerCase() ?? null,
    dep: end(f.departure, DONE_STATUSES.has(status)),
    arr: end(f.arrival, status === "Arrived" && !inferred) // an inferred landing has no actual time
  };
}

// ---------- endpoints ----------

// Flights for a callsign, flight number, registration or ICAO 24-bit address: on `date`
// (local, YYYY-MM-DD) if given, otherwise on the date nearest to now.
export async function flights(by, id, date = null) {
  const data = await request(
    `/flights/${by}/${encodeURIComponent(id)}${date ? `/${date}` : ""}`,
    { withAircraftImage: "false", withLocation: "false" },
    { 404: () => [] }
  );
  return Array.isArray(data) ? data : [];
}

const BOARD_DEFAULTS = { withCancelled: "true", withCodeshared: "false", withPrivate: "false", withLocation: "false" };
const airportPath = (code) => `/flights/airports/${code.length === 3 ? "iata" : "icao"}/${code}`;

// Arrivals and departures relative to now at the airport, e.g. offsetMinutes -360 for the last 6h.
// Codeshares are excluded so each physical flight appears once, under the operating airline.
export async function airportBoard(code, { offsetMinutes, durationMinutes, direction = "Both", withLeg = false, withCargo = true }) {
  const data = await request(airportPath(code), {
    ...BOARD_DEFAULTS, offsetMinutes, durationMinutes, direction, withLeg, withCargo
  }, {
    400: () => new HttpError(404, `Unknown airport "${code}"`),
    404: () => new HttpError(404, `Unknown airport "${code}"`)
  });
  return { arrivals: data?.arrivals ?? [], departures: data?.departures ?? [] };
}

// Same, for an explicit local time range (at most 12 hours), e.g. "2026-09-30T00:00".
export async function airportBoardRange(code, fromLocal, toLocal, { direction = "Both", withLeg = false, withCargo = true }) {
  const date = fromLocal.slice(0, 10);
  const data = await request(`${airportPath(code)}/${fromLocal}/${toLocal}`, { ...BOARD_DEFAULTS, direction, withLeg, withCargo }, {
    400: () => new HttpError(404, `No schedule data for ${code} on ${date}. AeroDataBox covers roughly the past few days to a week or so ahead.`),
    404: () => new HttpError(404, `Unknown airport "${code}"`)
  });
  return { arrivals: data?.arrivals ?? [], departures: data?.departures ?? [] };
}
