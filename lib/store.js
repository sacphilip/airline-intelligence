// Local history of observed flight movements (one departure or arrival of one flight), kept in
// SQLite so rankings and predictions can use more than the last few hours of live data.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DELAYED_MIN = 15;

export const normalizeNumber = (n) => (n ? String(n).toUpperCase().replace(/\s+/g, "") : null);

// A full flight leg (aerodatabox.toLeg shape) as its two movements: departure and arrival.
export function legToMovements(leg, source) {
  const delay = (end) => (end.sched != null && end.best != null ? Math.round((end.best - end.sched) / 60000) : null);
  const movement = (direction, here, there) => ({
    direction,
    number: leg.number,
    scheduled: here.sched,
    airport: here.airport,
    other: there.airport,
    airline: leg.airline,
    reg: leg.reg,
    best: here.best,
    actual: here.actual,
    cancelled: leg.cancelled,
    delayMin: leg.cancelled ? null : delay(here),
    status: leg.status,
    source
  });
  return [movement("Departure", leg.dep, leg.arr), movement("Arrival", leg.arr, leg.dep)];
}

export function openStore(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS movements (
      direction    TEXT    NOT NULL,              -- 'Departure' | 'Arrival'
      number       TEXT    NOT NULL,              -- flight number without spaces, e.g. BA117
      scheduled    INTEGER NOT NULL,              -- scheduled gate time, epoch ms (UTC)
      airport_iata TEXT,                          -- airport this movement happens at
      airport_icao TEXT,
      other_iata   TEXT,                          -- origin (for arrivals) / destination (for departures)
      other_icao   TEXT,
      airline_icao TEXT,
      airline_iata TEXT,
      airline_name TEXT,
      reg          TEXT,
      best         INTEGER,                       -- latest estimated or actual gate time, epoch ms
      actual       INTEGER NOT NULL DEFAULT 0,    -- 1 once the movement has happened
      cancelled    INTEGER NOT NULL DEFAULT 0,
      delay_min    INTEGER,
      status       TEXT,
      source       TEXT,
      first_seen   INTEGER NOT NULL,
      last_seen    INTEGER NOT NULL,
      PRIMARY KEY (direction, number, scheduled)
    );
    CREATE INDEX IF NOT EXISTS movements_airport ON movements (airport_iata, direction, scheduled);
    CREATE INDEX IF NOT EXISTS movements_airline ON movements (airline_icao, scheduled);
  `);

  // Later observations refine earlier ones, but never erase what we already know.
  const upsert = db.prepare(`
    INSERT INTO movements (direction, number, scheduled, airport_iata, airport_icao, other_iata, other_icao,
      airline_icao, airline_iata, airline_name, reg, best, actual, cancelled, delay_min, status, source, first_seen, last_seen)
    VALUES (:direction, :number, :scheduled, :airport_iata, :airport_icao, :other_iata, :other_icao,
      :airline_icao, :airline_iata, :airline_name, :reg, :best, :actual, :cancelled, :delay_min, :status, :source, :now, :now)
    ON CONFLICT (direction, number, scheduled) DO UPDATE SET
      airport_iata = COALESCE(excluded.airport_iata, airport_iata),
      airport_icao = COALESCE(excluded.airport_icao, airport_icao),
      other_iata   = COALESCE(excluded.other_iata, other_iata),
      other_icao   = COALESCE(excluded.other_icao, other_icao),
      airline_icao = COALESCE(excluded.airline_icao, airline_icao),
      airline_iata = COALESCE(excluded.airline_iata, airline_iata),
      airline_name = COALESCE(excluded.airline_name, airline_name),
      reg          = COALESCE(excluded.reg, reg),
      best         = CASE WHEN actual = 1 AND excluded.actual = 0 THEN best ELSE COALESCE(excluded.best, best) END,
      delay_min    = CASE WHEN actual = 1 AND excluded.actual = 0 THEN delay_min ELSE COALESCE(excluded.delay_min, delay_min) END,
      actual       = MAX(actual, excluded.actual),
      cancelled    = excluded.cancelled,
      status       = COALESCE(excluded.status, status),
      source       = excluded.source,
      last_seen    = excluded.last_seen
  `);

  const numberHistory = db.prepare(`
    SELECT COUNT(*) AS n,
           SUM(delay_min >= ${DELAYED_MIN}) AS delayed,
           AVG(MAX(delay_min, 0)) AS avg_delay,
           MIN(scheduled) AS since
    FROM movements
    WHERE number = ? AND direction = ? AND actual = 1 AND cancelled = 0 AND delay_min IS NOT NULL AND scheduled < ?
  `);
  const numberCancelled = db.prepare(`
    SELECT COUNT(*) AS n FROM movements WHERE number = ? AND direction = ? AND cancelled = 1 AND scheduled < ?
  `);

  // Departures from one airport within an hour either side of a given UTC hour. UTC works as a
  // stand-in for local time here because we only ever compare one airport with itself (DST aside).
  const airportHourHistory = db.prepare(`
    SELECT COUNT(*) AS n, SUM(delay_min >= ${DELAYED_MIN}) AS delayed, AVG(MAX(delay_min, 0)) AS avg_delay
    FROM movements
    WHERE (airport_iata = :iata OR airport_icao = :icao) AND direction = 'Departure'
      AND actual = 1 AND cancelled = 0 AND delay_min IS NOT NULL
      AND ((CAST(strftime('%H', scheduled / 1000, 'unixepoch') AS INTEGER) - :hour + 24) % 24 <= 1
        OR (CAST(strftime('%H', scheduled / 1000, 'unixepoch') AS INTEGER) - :hour + 24) % 24 = 23)
  `);

  const summary = db.prepare(`SELECT COUNT(*) AS n, MIN(first_seen) AS since FROM movements`);

  return {
    saveMovements(rows) {
      const now = Date.now();
      db.exec("BEGIN");
      try {
        for (const r of rows) {
          if (!r.number || r.scheduled == null) continue;
          upsert.run({
            direction: r.direction,
            number: normalizeNumber(r.number),
            scheduled: r.scheduled,
            airport_iata: r.airport?.iata ?? null,
            airport_icao: r.airport?.icao ?? null,
            other_iata: r.other?.iata ?? null,
            other_icao: r.other?.icao ?? null,
            airline_icao: r.airline?.icao ?? null,
            airline_iata: r.airline?.iata ?? null,
            airline_name: r.airline?.name ?? null,
            reg: r.reg ?? null,
            best: r.best ?? null,
            actual: r.actual ? 1 : 0,
            cancelled: r.cancelled ? 1 : 0,
            delay_min: r.delayMin ?? null,
            status: r.status ?? null,
            source: r.source ?? null,
            now
          });
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },

    // How this flight number has done in the past (completed movements only).
    flightHistory(number, direction = "Departure") {
      const key = normalizeNumber(number);
      if (!key) return null;
      const now = Date.now();
      const h = numberHistory.get(key, direction, now);
      const c = numberCancelled.get(key, direction, now);
      if (!h.n && !c.n) return null;
      return {
        observed: h.n,
        delayed: h.delayed ?? 0,
        delayedPct: h.n ? (h.delayed ?? 0) / h.n : null,
        avgDelay: h.avg_delay == null ? null : Math.round(h.avg_delay),
        cancelled: c.n,
        since: h.since
      };
    },

    airportHourHistory(airport, utcHour) {
      if (!airport) return null;
      const h = airportHourHistory.get({ iata: airport.iata ?? "", icao: airport.icao ?? "", hour: utcHour });
      if (!h.n) return null;
      return { observed: h.n, delayedPct: (h.delayed ?? 0) / h.n, avgDelay: Math.round(h.avg_delay ?? 0) };
    },

    summary() {
      return summary.get();
    },

    close() {
      db.close();
    }
  };
}
