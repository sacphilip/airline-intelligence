// Rule-based delay propagation along an aircraft's day ("aircraft chain").
//
// Deliberately simple and explainable: an aircraft can't leave before it has arrived and been
// turned around, so a late inbound flight pushes the next departure back by however much of the
// delay the scheduled turnaround can't absorb. Weather and recorded history don't change that
// estimate; they widen the window and can raise the risk level, and every adjustment is listed as
// a reason. No probabilities are invented.
//
// Legs use the shape from aerodatabox.toLeg(): { number, callSign, status, cancelled,
// dep: { airport, sched, best, actual }, arr: { ... } }, times in epoch ms.

export const DELAYED_MIN = 15;
const HIGH_MIN = 45;
const MAX_LEGS_AHEAD = 4;
const MIN_HISTORY = 5;          // flight-number observations before we mention its record
const MIN_AIRPORT_HISTORY = 20; // airport/hour observations before we mention it
const LEVELS = ["low", "moderate", "high"];
const AIRBORNE = new Set(["Departed", "EnRoute", "Approaching"]);

const WIDEBODY_TYPE = /^(A30|A31|A33|A34|A35|A38|B74|B76|B77|B78|IL96|MD11|DC10)/;
const REGIONAL_TYPE = /^(AT4|AT7|DH8|E1[0-9]|E17|E19|E75|CRJ|SF34|JS4|D328|B19|C208|L410|SW4)/;
const WIDEBODY_MODEL = /(A30[06]|A310|A33|A34|A35|A380|747|767|777|787)/;
const REGIONAL_MODEL = /(ATR|Dash 8|DHC-8|Q400|ERJ|Embraer 1[79]|E1[79]|E-Jet|CRJ|Saab)/i;

// Rough minimum ground time between flights, by aircraft size. typeCode is the ICAO type
// designator from ADS-B (A20N, B77W); model is AeroDataBox's text ("Boeing 777-300ER").
export function minTurnaround(typeCode, model) {
  if ((typeCode && WIDEBODY_TYPE.test(typeCode)) || (model && WIDEBODY_MODEL.test(model))) return { minutes: 75, kind: "wide-body" };
  if ((typeCode && REGIONAL_TYPE.test(typeCode)) || (model && REGIONAL_MODEL.test(model))) return { minutes: 25, kind: "regional" };
  return { minutes: 35, kind: "narrow-body" };
}

export const minutesBetween = (later, earlier) => (later == null || earlier == null ? null : Math.round((later - earlier) / 60000));
const levelOf = (delay) => (delay >= HIGH_MIN ? 2 : delay >= DELAYED_MIN ? 1 : 0);
const code = (ap) => ap?.iata || ap?.icao || "?";
const signed = (m) => `${m > 0 ? "+" : m < 0 ? "-" : ""}${Math.abs(m)} min`;
const depTime = (l) => l.dep.best ?? l.dep.sched;
const arrTime = (l) => l.arr.best ?? l.arr.sched;

// Which leg is the aircraft flying now? If it's on the ground, which leg did it last arrive from?
export function locateInChain(legs, { callsign, onGround, now = Date.now() }) {
  const cs = callsign?.replace(/\s+/g, "").toUpperCase();
  if (!onGround) {
    let i = legs.findIndex((l) => cs && l.callSign === cs && l.status !== "Arrived" && !l.cancelled);
    if (i < 0) i = legs.findIndex((l) => AIRBORNE.has(l.status));
    if (i < 0) i = legs.findIndex((l) => !l.cancelled && depTime(l) != null && arrTime(l) != null && depTime(l) <= now && now <= arrTime(l) + 15 * 60000);
    if (i >= 0) return { currentIndex: i, lastArrivedIndex: i - 1 };
  }
  let last = -1;
  legs.forEach((l, i) => { if (!l.cancelled && (l.arr.actual || (arrTime(l) != null && arrTime(l) <= now))) last = i; });
  return { currentIndex: -1, lastArrivedIndex: last };
}

// Each leg's delay state, plus predictions for the legs still to fly.
//   position:  { currentIndex, lastArrivedIndex } from locateInChain
//   liveArrDelay: our own estimate of the current leg's arrival delay (from position and speed),
//                 used only when the airline hasn't published one
//   deps: { weatherAt(airport, time), history } — injectable so the model can be tested offline
export async function predictChain(legs, { currentIndex, lastArrivedIndex, liveArrDelay = null, typeCode = null, model = null },
  { weatherAt = async () => null, history = null } = {}) {
  const turn = minTurnaround(typeCode, model ?? legs.find((l) => l.model)?.model);

  const described = legs.map((l, i) => {
    let arrDelay = l.cancelled ? null : minutesBetween(l.arr.best, l.arr.sched);
    let arrSource = arrDelay == null ? null : l.arr.actual ? "actual" : "airline";
    if (i === currentIndex && arrDelay == null && liveArrDelay != null) [arrDelay, arrSource] = [liveArrDelay, "position"];
    const state = l.cancelled ? "cancelled"
      : i === currentIndex ? "current"
      : i <= lastArrivedIndex || l.arr.actual ? "done"
      : "upcoming";
    return { ...l, index: i, state, depDelay: l.cancelled ? null : minutesBetween(l.dep.best, l.dep.sched), arrDelay, arrSource };
  });

  const anchor = currentIndex >= 0 ? currentIndex : lastArrivedIndex;
  const upcoming = described.filter((l) => l.state === "upcoming" && l.index > anchor).slice(0, MAX_LEGS_AHEAD);
  const inbound = anchor >= 0 ? described[anchor] : null;
  const sectorsFlown = described.filter((l) => l.state === "done" || l.state === "current").length;

  // Start from the inbound flight's arrival delay; early arrivals don't bank time.
  let prev = { leg: inbound, arrDelay: Math.max(0, inbound?.arrDelay ?? 0), arrSched: inbound?.arr.sched ?? null };
  const predictions = [];
  for (const [k, leg] of upcoming.entries()) {
    const p = await predictLeg(leg, k, prev, { turn, sectorsFlown, inboundDelay: k === 0 ? inbound?.arrDelay ?? null : prev.arrDelay }, { weatherAt, history });
    predictions.push(p);
    prev = { leg, arrDelay: Math.max(p.depDelay, Math.max(0, minutesBetween(leg.arr.best, leg.arr.sched) ?? 0)), arrSched: leg.arr.sched };
  }
  return { legs: described, predictions, turnaround: turn };
}

async function predictLeg(leg, k, prev, { turn, sectorsFlown, inboundDelay }, { weatherAt, history }) {
  const reasons = [];

  // 1. Knock-on delay from the aircraft's previous flight.
  const scheduledTurn = minutesBetween(leg.dep.sched, prev.arrSched);
  const slack = scheduledTurn == null ? 0 : Math.max(0, scheduledTurn - turn.minutes);
  const knockOn = Math.max(0, prev.arrDelay - slack);
  if (prev.leg) {
    const label = k === 0
      ? `Inbound ${prev.leg.number ?? "flight"} (${code(prev.leg.dep.airport)}→${code(prev.leg.arr.airport)})`
      : `Previous flight ${prev.leg.number ?? ""}`.trim();
    reasons.push({
      kind: "inbound",
      severity: levelOf(inboundDelay ?? 0),
      text: inboundDelay == null ? `${label}: arrival time unknown`
        : inboundDelay >= 5 ? `${label} ${k === 0 ? "is running" : "is expected to arrive"} ${signed(inboundDelay)} late`
        : `${label} ${k === 0 ? "is" : "is expected"} on time`
    });
    if (scheduledTurn != null) {
      reasons.push({
        kind: "turnaround",
        severity: prev.arrDelay > slack ? 1 : 0,
        text: `Scheduled turnaround ${scheduledTurn} min; a ${turn.kind} aircraft needs about ${turn.minutes} min` +
          (slack > 0 ? `, so up to ${slack} min of delay can be recovered on the ground` : ", so there is no spare time to recover delay")
      });
    }
  }

  // 2. The airline's own estimate wins when it is later.
  const airlineDelay = minutesBetween(leg.dep.best, leg.dep.sched);
  const depDelay = Math.max(knockOn, airlineDelay ?? 0);
  if (airlineDelay != null && airlineDelay >= 5) {
    reasons.push({ kind: "airline", severity: levelOf(airlineDelay), text: `Airline currently estimates departure ${signed(airlineDelay)}` });
  }
  let level = levelOf(depDelay);
  let widen = 10 + 5 * k; // uncertainty grows the further ahead we look

  // 3. Weather at departure and arrival.
  const forecasts = await Promise.all([weatherAt(leg.dep.airport, leg.dep.sched), weatherAt(leg.arr.airport, leg.arr.sched)]);
  for (const w of forecasts.filter(Boolean)) {
    reasons.push({ kind: "weather", severity: w.severity, text: w.text });
    widen += w.severity === 2 ? 20 : 10;
    if (w.severity === 2) level = Math.min(2, level + 1);
  }

  // 4. Recorded history, once there's enough of it to mean something.
  const record = history?.flightHistory(leg.number, "Departure");
  if (record?.observed >= MIN_HISTORY) {
    reasons.push({
      kind: "history",
      severity: record.delayedPct >= 0.5 ? 1 : 0,
      text: `${leg.number} has left ${DELAYED_MIN}+ min late on ${Math.round(record.delayedPct * 100)}% of ${record.observed} recorded flights (avg ${record.avgDelay} min)`
    });
    widen += Math.round(record.avgDelay / 2);
    if (record.delayedPct >= 0.5) level = Math.max(level, 1);
  }
  const airportRecord = leg.dep.sched == null ? null : history?.airportHourHistory(leg.dep.airport, new Date(leg.dep.sched).getUTCHours());
  if (airportRecord?.observed >= MIN_AIRPORT_HISTORY && airportRecord.delayedPct >= 0.3) {
    reasons.push({
      kind: "airport",
      severity: 1,
      text: `Departures from ${code(leg.dep.airport)} around this time leave ${DELAYED_MIN}+ min late ${Math.round(airportRecord.delayedPct * 100)}% of the time (${airportRecord.observed} recorded)`
    });
    widen += 5;
  }

  // 5. How much of the day is already behind this aircraft.
  const nth = sectorsFlown + k + 1;
  if (nth >= 4) reasons.push({ kind: "rotation", severity: 0, text: `This will be the aircraft's ${ordinal(nth)} flight today, so delays have had more chances to build up` });

  const window = [Math.max(0, depDelay - 5), depDelay + widen];
  // Assume the scheduled flight time holds, so the arrival moves with the departure.
  const arrAirline = Math.max(0, minutesBetween(leg.arr.best, leg.arr.sched) ?? 0);
  const shift = (t, m) => (t == null ? null : t + m * 60000);
  return {
    index: leg.index,
    level: LEVELS[level],
    depDelay,
    window,
    expectedDep: [shift(leg.dep.sched, window[0]), shift(leg.dep.sched, window[1])],
    expectedArr: [shift(leg.arr.sched, Math.max(window[0], arrAirline)), shift(leg.arr.sched, Math.max(window[1], arrAirline))],
    reasons
  };
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
