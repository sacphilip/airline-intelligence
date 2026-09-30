// What to call a flight's state, and how late it is. Pure functions (no DOM), shared by the
// flight page and the route table, and unit-tested in Node.
//
// A leg has { status, origin: { scheduled, estimated }, destination: { scheduled, estimated } },
// with epoch-ms times; `estimated` becomes the actual time once that end has happened.
import { DELAYED_MIN, minutesBetween } from "./format.js";

const SEVERE_MIN = 60;
export const DEPARTED = new Set(["Departed", "EnRoute", "Approaching", "Arrived", "Diverted"]);
const AIRBORNE_LABELS = { Departed: "Departed", EnRoute: "In the air", Approaching: "Approaching" };
// Stages before departure worth naming alongside "On time" / "Delayed".
const GROUND_STAGES = { CheckIn: "Check-in open", Boarding: "Boarding", GateClosed: "Gate closed" };

export const delayOf = (end) => minutesBetween(end?.estimated, end?.scheduled);

// "+17 min", "+1 h 03 min", "-5 min", "On time".
export function fmtDelayMinutes(minutes) {
  if (minutes == null) return "–";
  if (minutes === 0) return "On time";
  const abs = Math.abs(minutes);
  const text = abs < 60 ? `${abs} min` : `${Math.floor(abs / 60)} h ${String(abs % 60).padStart(2, "0")} min`;
  return `${minutes > 0 ? "+" : "-"}${text}`;
}

// ---------- timeline ----------
// How far along each airline status is: Scheduled 0, Check-in 1, Boarding 2, Gate 3, Departure 4, Arrival 5.
const STAGE = { Expected: 0, Delayed: 0, CheckIn: 1, Boarding: 2, GateClosed: 3, Departed: 4, EnRoute: 4, Approaching: 4, Diverted: 4, Arrived: 5 };
const CANCELLED = new Set(["Canceled", "CanceledUncertain"]);

// The flight's six stages, each { key, label, state, time, timeZone, timeKind, delay, detail }, where
// state is done | current | upcoming | cancelled | diverted | unknown. Airlines report which stage a
// flight is at but not when check-in or boarding happened, so only departure and arrival carry times.
export function flightTimeline(leg) {
  const { origin: o, destination: d, status } = leg;
  const departed = DEPARTED.has(status);
  const join = (...parts) => parts.filter(Boolean).join(" · ") || null;
  const steps = [
    { key: "scheduled", label: "Scheduled", time: o.scheduled, timeZone: o.airport?.timeZone, timeKind: "sched" },
    { key: "checkin", label: "Check-in", detail: join(o.terminal && `Terminal ${o.terminal}`, o.checkInDesk && `Desk ${o.checkInDesk}`) },
    { key: "boarding", label: "Boarding", detail: o.gate ? `Gate ${o.gate}` : null },
    { key: "gate", label: "Gate", detail: o.gate ? `Gate ${o.gate}${STAGE[status] >= 3 ? " closed" : ""}` : STAGE[status] >= 3 ? "Closed" : null },
    {
      key: "departure", label: "Departure",
      time: o.estimated ?? o.scheduled, timeZone: o.airport?.timeZone,
      timeKind: o.estimated == null ? "sched" : departed ? "actual" : "est", delay: delayOf(o)
    },
    {
      key: "arrival", label: "Arrival",
      time: d.estimated ?? d.scheduled, timeZone: d.airport?.timeZone,
      timeKind: d.estimated == null ? "sched" : status === "Arrived" && !leg.statusInferred ? "actual" : "est", delay: delayOf(d),
      detail: join(leg.statusInferred && "Landing time not reported", d.terminal && `Terminal ${d.terminal}`, d.baggageBelt && `Belt ${d.baggageBelt}`)
    }
  ].map((s) => ({ time: null, timeZone: null, timeKind: null, delay: null, detail: null, ...s }));

  const stage = STAGE[status];
  steps.forEach((s, i) => {
    if (CANCELLED.has(status)) s.state = i === 0 ? "done" : "cancelled";
    else if (stage == null) s.state = "unknown";                 // no status, or live position only
    else if (status === "Arrived") s.state = "done";
    else if (stage === 4) s.state = i < 5 ? "done" : status === "Diverted" ? "diverted" : "current"; // in the air
    else s.state = i < stage ? "done" : i === stage ? "current" : "upcoming";
  });

  // A word on where things stand now, for the stage that's in progress.
  const current = steps.find((s) => s.state === "current");
  if (status === "EnRoute" || status === "Departed") current.detail = join("In the air", current.detail);
  if (status === "Approaching") current.detail = join("Approaching", current.detail);
  if (status === "Diverted") steps[5].detail = "Diverted";
  if (CANCELLED.has(status)) steps[1].detail = status === "Canceled" ? "Flight cancelled" : "Flight possibly cancelled";
  return steps;
}

// { icon, text, detail, tone } where tone is good | warn | bad | live | neutral.
// The icon always comes with a text label, so colour is never the only signal.
export function flightStatus(leg) {
  const depDelay = delayOf(leg.origin);
  const arrDelay = delayOf(leg.destination);
  const s = leg.status;
  const result = (icon, text, tone, detail = null) => ({ icon, text, tone, detail, depDelay, arrDelay });

  if (!s) return result("⚪", leg.liveError ? "Live status unavailable" : "Not currently tracked", "neutral");
  if (s === "Canceled") return result("🔴", "Cancelled", "bad");
  if (s === "CanceledUncertain") return result("🔴", "Possibly cancelled", "bad");
  if (s === "Diverted") return result("🔴", "Diverted", "bad");
  // statusInferred: the server settled a long-overdue "in the air" as landed; there's no real arrival time.
  if (s === "Arrived" && leg.statusInferred) return result("🟢", "Landed", "good", "Arrival time not reported");
  if (s === "Arrived") return arrDelay >= DELAYED_MIN ? result("🟠", "Landed late", "warn") : result("🟢", "Landed", "good");
  if (AIRBORNE_LABELS[s]) return result("✈️", AIRBORNE_LABELS[s], "live", arrDelay >= DELAYED_MIN ? "Running late" : null);
  if (s === "OnGround") return result("⚪", "On the ground", "neutral"); // live position only, no schedule

  // Not departed yet: a published late departure time matters more than the airline's stage label.
  const stage = GROUND_STAGES[s] ?? null;
  if (depDelay >= SEVERE_MIN) return result("🔴", "Delayed", "bad", stage);
  if (depDelay >= DELAYED_MIN || s === "Delayed") return result("🟠", "Delayed", "warn", stage);
  if (stage) return result("🟢", stage, "good");
  if (s === "Expected") return result("🟢", depDelay == null ? "Scheduled" : "On time", "good");
  return result("⚪", s === "Unknown" ? "Status unknown" : s, "neutral");
}
