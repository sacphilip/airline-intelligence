// HTTP entry point: the route table. The work happens in lib/.
import http from "node:http";
import { lookupAircraft } from "./lib/aircraft.js";
import { PORT, PUBLIC_DIR } from "./lib/config.js";
import { history } from "./lib/db.js";
import { airportDelays, startCollector } from "./lib/delays.js";
import { parseFlightNumber, searchFlight, searchRoute } from "./lib/flight-search.js";
import { HttpError, Reply, airportParam, dateParam, needsKey, numberParam, sendJson, serveStatic } from "./lib/http.js";
import { isConfigured as hasScheduleKey } from "./lib/sources/aerodatabox.js";
import { RateLimitedError, aircraftNear } from "./lib/sources/adsb.js";
import { airlineNames } from "./lib/sources/airlines.js";
import { findPlace } from "./lib/sources/geocode.js";

const routes = {
  // Live aircraft within a radius (nautical miles) of a point, for the map.
  "GET /api/aircraft": async (params) => {
    const lat = numberParam(params, "lat", -90, 90);
    const lon = numberParam(params, "lon", -180, 180);
    const dist = numberParam(params, "dist", 1, 100000, 50);
    if (lat === null || lon === null || dist === null) throw new HttpError(400, "lat, lon and dist must be valid numbers");
    return aircraftNear(lat, lon, dist);
  },

  // Airline ICAO code -> name, so the page can label every aircraft in the list from its callsign.
  "GET /api/airlines": async () => new Reply(await airlineNames(), { "Cache-Control": "public, max-age=86400" }),

  // Route, STA/ETA and the aircraft's day with delay predictions, for the selected aircraft.
  "GET /api/flight": async (params) => {
    // Registrations sent as callsigns can contain a hyphen (G-ZBKC); keep letters and digits only.
    const callsign = params.get("callsign")?.toUpperCase().replace(/[^A-Z0-9]/g, "") || null;
    const hex = params.get("hex")?.trim().toLowerCase() || null;
    if (!callsign && !hex) throw new HttpError(400, "callsign or hex is required");
    if ((callsign && !/^[A-Z0-9]{2,8}$/.test(callsign)) || (hex && !/^~?[0-9a-f]{6}$/.test(hex))) {
      throw new HttpError(400, "invalid callsign or hex");
    }
    const lat = numberParam(params, "lat", -90, 90);
    const lon = numberParam(params, "lon", -180, 180);
    const live = lat == null || lon == null ? null : {
      lat, lon,
      groundSpeed: numberParam(params, "gs", 0, 2000),
      onGround: params.get("ground") === "1",
      type: params.get("type")?.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) || null
    };
    return lookupAircraft({ hex, callsign, live });
  },

  // Search by flight number (e.g. "6E 5321"), for the Find flight tab.
  "GET /api/search": async (params) => {
    const flight = parseFlightNumber(params.get("number"));
    if (!flight) throw new HttpError(400, "Enter a flight number like 6E 5321 or BA 117: the airline code followed by up to 4 digits");
    const result = await searchFlight(flight, dateParam(params, "date"));
    if (!result.legs.length) throw new HttpError(404, `No flight found for ${flight.display}`, { query: flight.display });
    return result;
  },

  // Flights between two airports on one local date, for the Find flight tab.
  "GET /api/route": async (params) => {
    const message = "Enter 3-letter IATA or 4-letter ICAO codes for both airports, e.g. BLR and DEL";
    const from = airportParam(params, "from", message);
    const to = airportParam(params, "to", message);
    if (from === to) throw new HttpError(400, "Departure and arrival airports must be different");
    const date = dateParam(params, "date", { required: true });
    if (!hasScheduleKey()) throw needsKey("Route search");
    return searchRoute(from, to, date);
  },

  // Arrivals/departures with delays at one airport, for the Delays tab.
  "GET /api/delays": async (params) => {
    const code = airportParam(params, "airport");
    if (!hasScheduleKey()) throw needsKey("Delay data");
    return airportDelays(code);
  },

  // How much flight history has been recorded so far.
  "GET /api/history": async () => history.summary(),

  // Place search for "jump to city".
  "GET /api/place": async (params) => {
    const q = params.get("q")?.trim();
    if (!q) throw new HttpError(400, "q is required");
    const place = await findPlace(q);
    if (!place) throw new HttpError(404, `Couldn't find "${q}"`);
    return place;
  }
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const handler = routes[`${req.method} ${url.pathname}`];
  try {
    if (handler) {
      const result = await handler(url.searchParams);
      return result instanceof Reply ? sendJson(res, 200, result.body, result.headers) : sendJson(res, 200, result);
    }
    if (req.method === "GET" && serveStatic(PUBLIC_DIR, url.pathname, res)) return;
    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    if (error instanceof HttpError) return sendJson(res, error.status, { error: error.message, ...error.extra });
    if (error instanceof RateLimitedError) return sendJson(res, 503, { error: error.message, retryAt: error.retryAt });
    console.error(error);
    sendJson(res, 502, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, () => {
  console.log(`Flight tracker running at http://localhost:${PORT}`);
  if (!hasScheduleKey()) console.log("No AERODATABOX_KEY set: schedules, delays and aircraft rotations are unavailable");
  startCollector();
});
