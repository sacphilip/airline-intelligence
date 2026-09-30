// Formatting helpers shared by every view. No DOM access, so they can be unit-tested in Node.

export const DELAYED_MIN = 15; // industry on-time threshold

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const fmt = (n, digits = 0) => (n == null ? "–" : Number(n).toLocaleString(undefined, { maximumFractionDigits: digits }));

export const minutesBetween = (later, earlier) => (later == null || earlier == null ? null : Math.round((later - earlier) / 60000));

export const airportCode = (ap) => ap?.iata || ap?.icao || "?";

// Clock time in the given time zone when known, otherwise UTC ("Z").
export function fmtClock(ms, timeZone) {
  if (ms == null) return "–";
  const opts = { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timeZone || "UTC" };
  try { return new Intl.DateTimeFormat("en-GB", opts).format(ms) + (timeZone ? "" : "Z"); }
  catch { return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(ms) + "Z"; }
}

export function fmtDay(ms, timeZone) {
  const opts = { weekday: "short", day: "numeric", month: "short", timeZone: timeZone || "UTC" };
  try { return new Intl.DateTimeFormat("en-GB", opts).format(ms); }
  catch { return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(ms); }
}

// Delay as signed HHmm, e.g. +0125 (1 h 25 min late) or -0010 (10 min early).
export function fmtDelay(minutes) {
  const abs = Math.abs(Math.round(minutes));
  const hhmm = String(Math.floor(abs / 60)).padStart(2, "0") + String(abs % 60).padStart(2, "0");
  return (minutes > 0 ? "+" : minutes < 0 ? "-" : "") + hhmm;
}

// Unsigned HHmm for durations and totals, e.g. 0345.
export const fmtDuration = (min) => fmtDelay(Math.max(0, Math.round(min))).replace("+", "");

// "2h 05m", for flight times.
export const fmtHoursMinutes = (min) => (min == null ? "–" : `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`);

// CSS class for a delay in minutes: late (15+), early (negative) or nothing.
export const delayClass = (d) => (d == null ? "" : d >= DELAYED_MIN ? "late" : d < 0 ? "early" : "");
