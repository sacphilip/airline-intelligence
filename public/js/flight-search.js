// The Find flight tab: search by flight number or by route and date.
import { $, KEY_HELP, getJson, showMessage, storage } from "./dom.js";
import { DEPARTED, delayOf, flightStatus, flightTimeline, fmtDelayMinutes } from "./flight-status.js";
import { DELAYED_MIN, airportCode, delayClass, esc, fmt, fmtClock, fmtDay, fmtDelay, fmtHoursMinutes } from "./format.js";

// Same rule as the server: 2-character IATA code (not two digits) or 3-letter ICAO code, 1-4 digits, optional suffix letter.
const FLIGHT_NUMBER = /^([A-Z]{3}|[A-Z0-9]{2})(\d{1,4})([A-Z]?)$/;
const isFlightNumber = (s) => { const m = s.match(FLIGHT_NUMBER); return Boolean(m && !/^\d\d$/.test(m[1])); };
const FS_HINT = "Airline code and number, like 6E 5321, BA 117 or UAE 1.";
const AIRPORT_CODE = /^[A-Z0-9]{3,4}$/;
const RS_HINT = "Airport codes, like BLR → DEL. The date is local at the departure airport.";
const todayLocal = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD

let request = 0; // bumping it discards the response of any search still in flight
let showOnMap = () => {};
const showFsMsg = (html, isError = false) => showMessage($("fs-msg"), html, isError);

const statusHtml = (status) =>
  `<span class="fs-status ${status.tone}"><span aria-hidden="true">${status.icon}</span> ${esc(status.text)}</span>` +
  (status.detail ? ` <span class="fs-status-detail">${esc(status.detail)}</span>` : "");

// ---------- by flight number ----------

// The headline facts: scheduled and actual/estimated departure, the delay, and the status.
function summaryHtml(leg, status) {
  const tz = leg.origin.airport?.timeZone;
  const departed = DEPARTED.has(leg.status) && leg.origin.estimated != null;
  const delay = status.depDelay;
  return `<dl class="fs-summary">
    <div><dt>Scheduled departure</dt><dd>${esc(fmtClock(leg.origin.scheduled, tz))}</dd></div>
    <div><dt>${departed ? "Actual" : "Estimated"} departure</dt><dd>${esc(fmtClock(leg.origin.estimated, tz))}</dd></div>
    <div><dt>Delay</dt><dd class="${delayClass(delay)}">${esc(fmtDelayMinutes(delay))}</dd></div>
    <div><dt>Status</dt><dd>${statusHtml(status)}</dd></div>
  </dl>`;
}

// Scheduled → Check-in → Boarding → Gate → Departure → Arrival, with where the flight is now.
const STEP_MARK = { done: "✓", cancelled: "✕", diverted: "!" };
const STEP_STATE = { done: "done", current: "in progress", upcoming: "not yet", cancelled: "cancelled", diverted: "diverted", unknown: "status unknown" };

function timelineHtml(leg) {
  return `<ol class="fs-timeline" aria-label="Flight progress">${flightTimeline(leg).map((s) => {
    const time = s.time == null ? "" : `<div class="time">${esc(fmtClock(s.time, s.timeZone))}` +
      // Only real times go unlabelled; the first step is the schedule itself.
      (s.timeKind === "est" ? ` <span class="k">est.</span>` : s.timeKind === "sched" && s.key !== "scheduled" ? ` <span class="k">sched.</span>` : "") +
      (s.delay ? ` <span class="${delayClass(s.delay)}">${esc(fmtDelayMinutes(s.delay))}</span>` : "") + "</div>";
    return `<li class="${s.state}"${s.state === "current" ? ` aria-current="step"` : ""}>
      <span class="dot" aria-hidden="true">${STEP_MARK[s.state] ?? ""}</span>
      <div class="label">${esc(s.label)} <span class="sr">(${STEP_STATE[s.state]})</span></div>
      ${time}
      ${s.detail ? `<div class="detail">${esc(s.detail)}</div>` : ""}
    </li>`;
  }).join("")}</ol>`;
}

function endHtml(end, kind, happened) {
  const ap = end.airport ?? {};
  const tz = ap.timeZone;
  const delay = delayOf(end);
  const rows = [
    ["Scheduled", end.scheduled == null ? "–" : `${fmtClock(end.scheduled, tz)} · ${fmtDay(end.scheduled, tz)}`],
    [happened && end.estimated != null ? "Actual" : "Estimated", end.estimated == null ? "–" : `${fmtClock(end.estimated, tz)}${delay ? ` (${fmtDelayMinutes(delay)})` : ""}`, delayClass(delay)],
  ];
  if (end.terminal) rows.push(["Terminal", end.terminal]);
  if (end.gate) rows.push(["Gate", end.gate]);
  return `<div class="fs-end">
    <div class="place">${kind}</div>
    <div class="code">${esc(ap.iata || ap.icao || "?")}</div>
    <div class="place">${esc([ap.city, ap.name].filter(Boolean).join(" · "))}</div>
    <dl>${rows.map(([k, v, cls = ""]) => `<dt>${k}</dt><dd class="${cls}">${esc(v)}</dd>`).join("")}</dl>
  </div>`;
}

function renderFlightResults(result) {
  $("fs-results").innerHTML = result.legs.map((leg, i) => {
    const status = flightStatus(leg);
    const notes = [];
    if (!result.scheduleAvailable) notes.push("Scheduled times need an AeroDataBox key (set AERODATABOX_KEY on the server); route from adsb.lol.");
    else if (result.source !== "aerodatabox") notes.push("No schedule found for this flight; route from adsb.lol.");
    if (!leg.status) {
      notes.push(leg.liveError
        ? `Couldn't check its live position (${leg.liveError}). Try again shortly.`
        : "Not seen by adsb.lol receivers right now, so its live status is unknown.");
    }
    if (leg.origin.scheduled != null || leg.destination.scheduled != null) notes.push("Times are local at each airport.");
    const live = leg.live;
    const liveText = live ? (live.onGround ? "Live: on the ground" : `Live: ${fmt(live.altitude)} ft · ${fmt(live.groundSpeed)} kt`) : "";
    const aircraft = [leg.aircraft?.model, leg.aircraft?.registration ?? live?.registration].filter(Boolean).join(" · ");
    return `<article class="fs-card">
      <div class="fs-head">
        <div>
          <h2>${esc(leg.number)}</h2>
          <div class="fs-route">${esc(airportCode(leg.origin.airport))} → ${esc(airportCode(leg.destination.airport))}</div>
          <div class="airline">${esc(leg.airline?.name ?? "Unknown airline")}${aircraft ? ` · ${esc(aircraft)}` : ""}</div>
        </div>
      </div>
      ${summaryHtml(leg, status)}
      ${timelineHtml(leg)}
      <div class="fs-legs">
        ${endHtml(leg.origin, "From", DEPARTED.has(leg.status))}
        <div class="fs-arrow" aria-hidden="true">→</div>
        ${endHtml(leg.destination, "To", leg.status === "Arrived" && !leg.statusInferred)}
      </div>
      <div class="fs-foot">
        <div class="fs-note">${esc([liveText, ...notes].filter(Boolean).join(" · "))}</div>
        ${live ? `<button type="button" data-show="${i}">Show on map</button>` : ""}
      </div>
    </article>`;
  }).join("");
  $("fs-results")._legs = result.legs;
}

async function searchFlight(raw, date = null) {
  const q = raw.toUpperCase().replace(/[\s-]/g, "");
  const invalid = !isFlightNumber(q);
  $("fs-input").setAttribute("aria-invalid", String(invalid));
  $("fs-hint").classList.toggle("error", invalid);
  $("fs-hint").textContent = invalid
    ? (q ? `"${raw.trim()}" isn't a flight number. ${FS_HINT}` : `Enter a flight number. ${FS_HINT}`)
    : FS_HINT;
  const req = ++request;
  $("fs-results").innerHTML = "";
  if (invalid) return showFsMsg("");
  storage.set("ft-flight", raw.trim());
  showFsMsg("Searching…");
  try {
    const { ok, status, data } = await getJson(`/api/search?${new URLSearchParams(date ? { number: q, date } : { number: q })}`);
    if (req !== request) return; // superseded by a newer search
    if (!ok) return showFsMsg(esc(data.error || `Search failed (HTTP ${status})`), status !== 404);
    showFsMsg("");
    renderFlightResults(data);
    // A shareable address for this flight, e.g. #flight/6E5321 or #flight/6E5321/2026-09-30.
    history.replaceState?.(null, "", `#flight/${encodeURIComponent(q)}${date ? `/${date}` : ""}`);
  } catch (err) {
    if (req === request) showFsMsg(esc(err.message || "Search failed"), true);
  }
}

// ---------- by route ----------
function setMode(mode) {
  document.querySelectorAll(".fs-mode [data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
  $("fs-form").hidden = mode !== "number";
  $("fs-results").hidden = mode !== "number";
  $("rs-form").hidden = mode !== "route";
  $("rs-results").hidden = mode !== "route" || !$("rs-table").children.length;
  request++; // drop any response for the other mode
  showFsMsg("");
  storage.set("ft-fs-mode", mode);
  (mode === "route" ? $("rs-from") : $("fs-input")).focus();
}

function timeCell(end, happened, originDate) {
  if (!end.scheduledLocal) return "–";
  const nextDay = originDate && end.date && end.date !== originDate ? `<span class="next-day" title="${esc(end.date)}">+1</span>` : "";
  const changed = end.estimatedLocal && end.estimatedLocal !== end.scheduledLocal;
  return `${esc(end.scheduledLocal)}${nextDay}` +
    (changed ? `<div class="sub">${happened ? "act." : "est."} ${esc(end.estimatedLocal)}</div>` : "") +
    (end.terminal ? `<div class="sub">T${esc(end.terminal)}</div>` : "");
}

function renderRouteResults(data) {
  const flights = data.flights;
  const destName = data.destination?.name;
  $("rs-title").textContent = `${data.from} → ${data.to}${destName ? ` (${destName})` : ""} · ${fmtDay(Date.parse(`${data.date}T12:00Z`))}`;
  const delayed = flights.filter((f) => f.delayMin >= DELAYED_MIN).length;
  const cancelled = flights.filter((f) => f.cancelled).length;
  $("rs-summary").textContent = `${fmt(flights.length)} flight${flights.length === 1 ? "" : "s"}` +
    (delayed ? ` · ${fmt(delayed)} delayed 15+ min` : "") + (cancelled ? ` · ${fmt(cancelled)} cancelled` : "");

  $("rs-table").innerHTML = flights.map((f, i) => {
    const status = flightStatus(f);
    const d = f.delayMin;
    const cls = d == null ? "muted" : delayClass(d);
    return `<tr data-i="${i}" class="${f.cancelled ? "cancelled" : ""}" title="Show details for ${esc(f.number ?? "")}">
      <td>${esc(f.airline?.name ?? "–")}${f.aircraft ? `<div class="sub">${esc(f.aircraft)}</div>` : ""}</td>
      <td><b>${esc(f.number ?? "–")}</b></td>
      <td class="num">${timeCell(f.origin, DEPARTED.has(f.status), f.origin.date)}</td>
      <td class="num">${timeCell(f.destination, f.status === "Arrived" && !f.statusInferred, f.origin.date)}</td>
      <td class="num">${fmtHoursMinutes(f.durationMin)}</td>
      <td>${statusHtml({ ...status, detail: null })}</td>
      <td class="num ${cls}">${d == null ? "–" : d === 0 ? "On time" : `${fmtDelay(d)} <span class="sub">${f.delayOf}</span>`}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="7" class="muted">No direct flights found from ${esc(data.from)} to ${esc(data.to)} on this date.</td></tr>`;
  $("rs-table")._flights = flights;

  $("rs-note").textContent = `Times are local at each airport; +1 means the next day. Delay is against the scheduled gate time: ` +
    `departure (dep) until the flight leaves, arrival (arr) after. Direct flights only; codeshares are listed once, under the operating airline. ` +
    `Select a flight for its full details. Updated ${new Date(data.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`;
  $("rs-results").hidden = false;
}

async function searchRoute() {
  const from = $("rs-from").value.trim().toUpperCase();
  const to = $("rs-to").value.trim().toUpperCase();
  const date = $("rs-date").value;
  const problems = [];
  if (!AIRPORT_CODE.test(from)) problems.push(["rs-from", "Enter a departure airport code, like BLR."]);
  if (!AIRPORT_CODE.test(to)) problems.push(["rs-to", "Enter an arrival airport code, like DEL."]);
  if (!problems.length && from === to) problems.push(["rs-to", "Departure and arrival airports must be different."]);
  if (!date) problems.push(["rs-date", "Choose a date."]);
  ["rs-from", "rs-to", "rs-date"].forEach((id) => $(id).setAttribute("aria-invalid", String(problems.some(([p]) => p === id))));
  $("rs-hint").classList.toggle("error", problems.length > 0);
  $("rs-hint").textContent = problems.length ? problems.map(([, m]) => m).join(" ") : RS_HINT;

  const req = ++request;
  $("rs-results").hidden = true;
  $("rs-table").innerHTML = "";
  if (problems.length) return showFsMsg("");
  storage.set("ft-route", JSON.stringify({ from, to }));

  showFsMsg(`Searching ${esc(from)} → ${esc(to)}…`);
  try {
    const { ok, status, data } = await getJson(`/api/route?${new URLSearchParams({ from, to, date })}`);
    if (req !== request) return;
    if (!ok) {
      return showFsMsg(data.needsKey
        ? `Route search needs flight schedules from AeroDataBox. ${KEY_HELP}`
        : esc(data.error || `Search failed (HTTP ${status})`), !data.needsKey);
    }
    showFsMsg("");
    renderRouteResults(data);
  } catch (err) {
    if (req === request) showFsMsg(esc(err.message || "Search failed"), true);
  }
}

// ---------- setup ----------
export const focusFlightSearch = () => $("fs-input").focus();

// Show one flight's page, e.g. from a #flight/6E5321 link.
export function openFlight(number, date = null) {
  setMode("number");
  const m = String(number).toUpperCase().replace(/[\s-]/g, "").match(FLIGHT_NUMBER);
  $("fs-input").value = m ? `${m[1]} ${m[2]}${m[3]}` : number; // "6E5321" from the link reads as "6E 5321"
  searchFlight($("fs-input").value, /^\d{4}-\d{2}-\d{2}$/.test(date ?? "") ? date : null);
}

// onShowOnMap(live): called with the live aircraft when the user picks "Show on map".
export function initFlightSearch({ onShowOnMap }) {
  showOnMap = onShowOnMap;

  $("fs-form").addEventListener("submit", (e) => { e.preventDefault(); searchFlight($("fs-input").value); });
  $("fs-input").addEventListener("input", () => {
    if ($("fs-input").getAttribute("aria-invalid") !== "true") return;
    $("fs-input").setAttribute("aria-invalid", "false");
    $("fs-hint").classList.remove("error");
    $("fs-hint").textContent = FS_HINT;
  });
  $("fs-results").addEventListener("click", (e) => {
    const live = $("fs-results")._legs?.[e.target.closest("[data-show]")?.dataset.show]?.live;
    if (live) showOnMap(live);
  });
  $("fs-input").value = storage.get("ft-flight", "");

  document.querySelectorAll(".fs-mode [data-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
  $("rs-form").addEventListener("submit", (e) => { e.preventDefault(); searchRoute(); });
  $("rs-swap").addEventListener("click", () => { [$("rs-from").value, $("rs-to").value] = [$("rs-to").value, $("rs-from").value]; });
  $("rs-table").addEventListener("click", (e) => {
    const f = $("rs-table")._flights?.[e.target.closest("tr[data-i]")?.dataset.i];
    if (!f?.number) return;
    setMode("number");
    $("fs-input").value = f.number;
    searchFlight(f.number, f.origin.date);
  });
  try {
    const saved = JSON.parse(storage.get("ft-route", "null"));
    if (saved) { $("rs-from").value = saved.from; $("rs-to").value = saved.to; }
  } catch {}
  $("rs-date").value = todayLocal();
  if (storage.get("ft-fs-mode") === "route") setMode("route");
}
