// "Aircraft's day": every flight the selected airframe flies today, how late each one ran, and
// predicted delays for the flights still to come (from the server's rule-based model).
import { DELAYED_MIN, airportCode, delayClass, esc, fmtClock, fmtDelay } from "./format.js";

const LEVEL_LABEL = { low: "Low delay risk", moderate: "Moderate delay risk", high: "High delay risk" };
const LEVEL_ICON = { low: "🟢", moderate: "🟠", high: "🔴" };

const route = (leg) => `${esc(airportCode(leg.dep.airport))} → ${esc(airportCode(leg.arr.airport))}`;
const depClock = (leg, ms = leg.dep.sched) => fmtClock(ms, leg.dep.airport?.timeZone);
const arrClock = (leg, ms = leg.arr.sched) => fmtClock(ms, leg.arr.airport?.timeZone);
const timeRange = ([lo, hi], fmtTime) => (fmtTime(lo) === fmtTime(hi) ? fmtTime(lo) : `${fmtTime(lo)}–${fmtTime(hi)}`);

// How late a leg ran: arrival delay once known, else departure delay.
function outcome(leg) {
  const d = leg.arrDelay ?? leg.depDelay;
  if (leg.cancelled) return { icon: "⛔", text: "Cancelled", cls: "late" };
  if (d == null) return { icon: "·", text: leg.state === "done" ? "Times unknown" : "", cls: "" };
  const icon = d >= 60 ? "❌" : d >= DELAYED_MIN ? "⚠️" : "✅";
  return { icon, text: d === 0 ? "On time" : fmtDelay(d), cls: delayClass(d) };
}

function legRow(leg, prediction, isThisFlight) {
  let icon, text, cls = "";
  if (leg.state === "current") {
    const d = leg.arrDelay;
    icon = "✈️";
    text = d == null ? "In the air" : `In the air · arr ${d === 0 ? "on time" : fmtDelay(d)}${leg.arrSource === "position" ? " est." : ""}`;
    cls = delayClass(d);
  } else if (leg.state === "upcoming" && prediction) {
    icon = LEVEL_ICON[prediction.level];
    // Kept short so the route stays readable; the card below spells out the level and times.
    text = prediction.window[1] < DELAYED_MIN ? "likely on time" : `+${prediction.window[0]}–${prediction.window[1]} min`;
    cls = `risk-${prediction.level}`;
  } else if (leg.state === "upcoming") {
    icon = "·";
    text = "Scheduled";
  } else {
    ({ icon, text, cls } = outcome(leg));
  }
  return `<li class="${isThisFlight ? "this" : ""} ${leg.state}">
    <span class="t">${esc(depClock(leg))}</span>
    <span class="r">${route(leg)}<span class="n">${esc(leg.number ?? "")}</span></span>
    <span class="o ${cls}"${prediction ? ` title="${LEVEL_LABEL[prediction.level]}"` : ""}><span aria-hidden="true">${icon}</span> ${esc(text)}</span>
  </li>`;
}

function predictionCard(leg, p, open) {
  const reasons = p.reasons.map((r) => `<li class="sev-${r.severity}">${esc(r.text)}</li>`).join("");
  return `<details class="pred risk-${p.level}" ${open ? "open" : ""}>
    <summary>
      <span class="pred-title">${LEVEL_ICON[p.level]} ${esc(leg.number ?? "Next flight")} ${route(leg)} · ${LEVEL_LABEL[p.level]}</span>
    </summary>
    <dl>
      <div><dt>Scheduled</dt><dd>${esc(depClock(leg))} → ${esc(arrClock(leg))}</dd></div>
      <div><dt>Expected departure</dt><dd>${esc(timeRange(p.expectedDep, (t) => depClock(leg, t)))}</dd></div>
      ${p.expectedArr[0] != null ? `<div><dt>Expected arrival</dt><dd>${esc(timeRange(p.expectedArr, (t) => arrClock(leg, t)))}</dd></div>` : ""}
    </dl>
    ${reasons ? `<div class="why">Why</div><ul class="reasons">${reasons}</ul>` : ""}
  </details>`;
}

// How far behind the aircraft is right now: the flight in the air, else the last one flown.
function runningLate(legs) {
  const current = legs.find((l) => l.state === "current");
  const last = [...legs].reverse().find((l) => l.state === "done" && l.arrDelay != null);
  const ref = current?.arrDelay != null ? current : last;
  return ref && ref.arrDelay >= DELAYED_MIN ? ref.arrDelay : null;
}

export function renderChain(chain, { reg, model } = {}) {
  if (!chain?.legs?.length) return "";
  const byIndex = new Map(chain.predictions.map((p) => [p.index, p]));
  const late = runningLate(chain.legs);
  const next = chain.predictions[0];
  const nextLeg = next && chain.legs[next.index];

  const headline = late
    ? `<div class="chain-alert">⚠️ This aircraft is running ${fmtDelay(late)} (${late} min) behind schedule.` +
      (next ? ` Estimated knock-on for ${esc(nextLeg.number ?? "its next flight")}: ${next.window[0]}–${next.window[1]} min.` : "") + "</div>"
    : "";

  return `
    <h3 class="chain-head">Aircraft's day${reg ? ` · ${esc(reg)}` : ""}${model ? ` <span class="muted">${esc(model)}</span>` : ""}</h3>
    ${headline}
    <ol class="chain">${chain.legs.map((l) => legRow(l, byIndex.get(l.index), l.index === chain.flightIndex)).join("")}</ol>
    ${chain.predictions.map((p, i) => predictionCard(chain.legs[p.index], p, i === 0)).join("")}
    ${chain.predictions.length ? `<p class="chain-note">Estimates start from the incoming flight's delay and the minimum time this aircraft
      type needs on the ground (about ${chain.turnaround.minutes} min for a ${esc(chain.turnaround.kind)}), then allow for weather and
      recorded history. A guide, not an airline forecast. Times are local at each airport.</p>` : ""}`;
}
