// adsb.lol: live aircraft positions (rate-limited API) and its static route database.
import { USER_AGENT } from "../config.js";
import { TtlCache } from "../cache.js";

const API = "https://api.adsb.lol/v2";
const ROUTES = "https://vrs-standing-data.adsb.lol/routes";
export const MAX_RADIUS_NM = 250; // adsb.lol's limit for point queries
const RADIUS_STEPS_NM = [10, 25, 50, 100, 150, 200, MAX_RADIUS_NM];
const FRESH_MS = 8000;
const MIN_GAP_MS = 2000; // never call adsb.lol more than once per 2s
const STALE_MAX_MS = 5 * 60 * 1000;

export class RateLimitedError extends Error {
  constructor(retryAt) {
    super("adsb.lol is rate-limiting requests");
    this.retryAt = retryAt;
  }
}

// Shared so several open tabs (or panning around one area) share one upstream request.
const cache = new TtlCache(STALE_MAX_MS);
let lastRequestAt = 0;
let blockedUntil = 0;
let backoffMs = 0;

async function fetchThrottled(url) {
  const fresh = cache.get(url, FRESH_MS);
  if (fresh) return fresh;
  const stale = cache.get(url);

  // While backing off, or when requests come too fast, serve the last good data instead.
  const now = Date.now();
  if (now < blockedUntil || now - lastRequestAt < MIN_GAP_MS) {
    if (stale) return stale;
    if (now < blockedUntil) throw new RateLimitedError(blockedUntil);
    await new Promise((resolve) => setTimeout(resolve, MIN_GAP_MS - (now - lastRequestAt)));
  }

  lastRequestAt = Date.now();
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (response.status === 429 || response.status === 420) { // adsb.lol uses both for rate limiting
    // Exponential backoff: 30s, 60s, 120s ... up to 5 minutes.
    const retryAfter = Number(response.headers.get("retry-after")) * 1000;
    backoffMs = Math.min(backoffMs ? backoffMs * 2 : 30000, 5 * 60 * 1000);
    blockedUntil = Date.now() + (retryAfter || backoffMs);
    console.warn(`adsb.lol rate limit hit; pausing requests for ${Math.round((blockedUntil - Date.now()) / 1000)}s`);
    if (stale) return stale;
    throw new RateLimitedError(blockedUntil);
  }
  if (!response.ok) throw new Error(`Upstream request failed (${response.status})`);
  const data = await response.json();
  backoffMs = 0;
  return cache.set(url, data);
}

const hasPosition = (ac) => typeof ac.lat === "number" && typeof ac.lon === "number";

export function normalizeAircraft(ac) {
  const onGround = ac.alt_baro === "ground";
  const squawk = ac.squawk ?? null;
  const emergency =
    (ac.emergency && ac.emergency !== "none" ? ac.emergency : null) ??
    ({ "7500": "hijack", "7600": "radio failure", "7700": "general emergency" }[squawk] ?? null);

  return {
    hex: ac.hex,
    callsign: ac.flight?.trim() || null,
    registration: ac.r ?? null,
    type: ac.t ?? null,
    description: ac.desc ?? null,
    lat: ac.lat,
    lon: ac.lon,
    onGround,
    altitude: onGround ? 0 : (typeof ac.alt_baro === "number" ? ac.alt_baro : ac.alt_geom ?? null),
    groundSpeed: ac.gs ?? null,
    track: ac.track ?? ac.true_heading ?? ac.mag_heading ?? null,
    verticalRate: ac.baro_rate ?? ac.geom_rate ?? null,
    squawk,
    emergency,
    distance: ac.dst ?? null,
    seen: ac.seen ?? null
  };
}

// Live aircraft within `dist` nautical miles of a point.
export async function aircraftNear(lat, lon, dist) {
  // Snap to a coarse grid and radius step (padded to cover the snapping) so nearby
  // views share one cached upstream request.
  const grid = dist <= 40 ? 0.1 : 0.5;
  const pad = grid === 0.1 ? 5 : 25; // worst-case snapping offset, in nm
  const radius = RADIUS_STEPS_NM.find((step) => step >= dist + pad) ?? MAX_RADIUS_NM;
  const snap = (v) => (Math.round(v / grid) * grid).toFixed(1);
  const data = await fetchThrottled(`${API}/point/${snap(lat)}/${snap(lon)}/${radius}`);
  return {
    now: data.now ?? Date.now(),
    radius,
    aircraft: (data.ac ?? []).filter(hasPosition).map(normalizeAircraft)
  };
}

// The aircraft with this ICAO hex or callsign right now, if adsb.lol can see it: { aircraft } or { error }.
export async function findLive({ hex, callsign }) {
  const url = hex ? `${API}/hex/${hex}` : callsign ? `${API}/callsign/${callsign}` : null;
  if (!url) return { aircraft: null };

  // The map's recent area queries may already include it; that avoids an upstream call (and
  // keeps working while adsb.lol is rate-limiting us).
  const matches = (a) => (hex ? a.hex === hex : a.flight?.trim() === callsign) && hasPosition(a);
  for (const data of cache.recent(60 * 1000)) {
    const ac = data?.ac?.find(matches);
    if (ac) return { aircraft: normalizeAircraft(ac) };
  }

  try {
    const data = await fetchThrottled(url);
    const ac = (data.ac ?? []).find(hasPosition);
    return { aircraft: ac ? normalizeAircraft(ac) : null };
  } catch (error) {
    console.warn(`live lookup failed: ${error.message}`);
    return { error: error instanceof RateLimitedError ? "adsb.lol is rate-limiting requests" : error.message };
  }
}

// Origin and destination for a callsign from adsb.lol's route database (one JSON file per
// callsign, grouped by its first two letters). No times: it's a list of routes, not a schedule.
export async function lookupRoute(callsign) {
  if (!callsign) return null;
  const response = await fetch(`${ROUTES}/${callsign.slice(0, 2)}/${callsign}.json`, { headers: { "User-Agent": USER_AGENT } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`adsb.lol route lookup failed (${response.status})`);
  const route = await response.json();
  const airports = route?._airports;
  if (!Array.isArray(airports) || airports.length < 2) return null;
  const toAirport = (ap) => ({
    iata: ap.iata ?? null, icao: ap.icao ?? null, name: ap.name ?? null, city: ap.location ?? null,
    lat: ap.lat ?? null, lon: ap.lon ?? null, timeZone: null
  });
  return {
    airlineCode: route.airline_code ?? null,
    routeNumber: route.number ?? null, // e.g. "117"; combine with the airline's IATA code for "BA 117"
    origin: toAirport(airports[0]),
    destination: toAirport(airports[airports.length - 1])
  };
}
