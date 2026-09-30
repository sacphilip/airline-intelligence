// The Delays tab: one airport's flights with delays, and airlines ranked by the delay they caused.
import { $, KEY_HELP, getJson, showMessage, storage } from "./dom.js";
import { DELAYED_MIN, delayClass, esc, fmt, fmtDelay, fmtDuration } from "./format.js";

const RANK_CHART_LIMIT = 15;
const FLIGHT_TABLE_LIMIT = 300;
const REFRESH_MS = 15 * 60 * 1000; // matches the server's cache
const RANK_METRICS = {
  total: { label: "Total delay", value: (r) => r.totalMin, fmt: (v) => fmtDuration(v) },
  delayed: { label: "Delayed flights", value: (r) => r.delayed, fmt: (v) => fmt(v) },
  pct: { label: "% delayed", value: (r) => r.delayed / r.flights, fmt: (v) => `${fmt(v * 100)}%` },
  avg: { label: "Avg delay", value: (r) => r.totalMin / r.flights, fmt: (v) => fmtDuration(Math.round(v)) },
};

const state = { data: null, loading: false, airport: null, direction: "Both", active: false };
const showDelayMsg = (html, isError = false) => showMessage($("delay-msg"), html, isError);
const inDirection = (flights) => flights.filter((f) => state.direction === "Both" || f.direction === state.direction);

export async function loadDelays(code) {
  code = String(code ?? "").trim().toUpperCase();
  if (!code) return;
  $("delay-airport").value = code;
  storage.set("ft-delay-airport", code);
  state.airport = code;
  state.loading = true;
  $("delay-meta").textContent = `Loading ${code}…`;
  showDelayMsg("");
  try {
    const { ok, status, data } = await getJson(`/api/delays?airport=${encodeURIComponent(code)}`);
    if (state.airport !== code) return; // a newer request superseded this one
    if (!ok) {
      state.data = null;
      $("delay-content").hidden = true;
      $("delay-meta").textContent = "";
      showDelayMsg(data.needsKey
        ? `Airport delay data comes from AeroDataBox, which needs a free API key.<br>${KEY_HELP}`
        : esc(data.error || `Request failed (HTTP ${status})`), !data.needsKey);
      return;
    }
    state.data = data;
    render();
    loadHistorySummary();
  } catch (err) {
    if (state.airport === code) showDelayMsg(esc(err.message || "Request failed"), true);
  } finally {
    if (state.airport === code) state.loading = false;
  }
}

async function loadHistorySummary() {
  try {
    const { ok, data } = await getJson("/api/history");
    $("history-meta").textContent = ok && data.n
      ? `· History: ${fmt(data.n)} flight movements recorded since ${new Date(data.since).toLocaleDateString([], { day: "numeric", month: "short" })}`
      : "";
  } catch {}
}

export function rankAirlines(flights) {
  const byAirline = new Map();
  for (const f of flights) {
    const key = f.airline ? (f.airline.icao || f.airline.iata || f.airline.name) : null;
    if (!key) continue;
    let r = byAirline.get(key);
    if (!r) byAirline.set(key, r = { name: f.airline.name, code: f.airline.iata || f.airline.icao, flights: 0, delayed: 0, totalMin: 0, worst: null, cancelled: 0 });
    if (f.cancelled) { r.cancelled++; continue; }
    if (f.delayMin == null) continue;
    r.flights++;
    if (f.delayMin >= DELAYED_MIN) r.delayed++;
    r.totalMin += Math.max(0, f.delayMin);
    if (!r.worst || f.delayMin > r.worst.delayMin) r.worst = f;
  }
  return [...byAirline.values()];
}

function render() {
  const data = state.data;
  if (!data) return;
  const all = inDirection(data.flights);
  const timed = all.filter((f) => !f.cancelled && f.delayMin != null);
  const cancelled = all.filter((f) => f.cancelled);
  const delayed = timed.filter((f) => f.delayMin >= DELAYED_MIN);
  const worst = timed.reduce((w, f) => (!w || f.delayMin > w.delayMin ? f : w), null);
  const dirLabel = { Arrival: "arrivals", Departure: "departures", Both: "flights" }[state.direction];

  $("delay-content").hidden = false;
  $("delay-meta").textContent = `${data.airport} ${dirLabel}, 6 h ago to 6 h ahead · updated ${new Date(data.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · refreshes every 15 min`;
  showDelayMsg(all.length ? "" : `No ${dirLabel} found for ${esc(data.airport)} in this window. AeroDataBox may not cover this airport.`);

  $("t-flights").textContent = fmt(timed.length);
  $("t-flights-note").textContent = `${fmt(all.length - timed.length - cancelled.length)} awaiting times`;
  $("t-delayed").textContent = fmt(delayed.length);
  $("t-delayed-note").textContent = timed.length ? `${fmt((delayed.length / timed.length) * 100)}% of flights` : "";
  $("t-avg").textContent = timed.length ? fmtDuration(timed.reduce((s, f) => s + Math.max(0, f.delayMin), 0) / timed.length) : "–";
  $("t-worst").textContent = worst && worst.delayMin > 0 ? fmtDuration(worst.delayMin) : "–";
  $("t-worst-note").textContent = worst && worst.delayMin > 0 ? [worst.number, worst.airline?.name].filter(Boolean).join(" · ") : "";
  $("t-cancel").textContent = fmt(cancelled.length);
  $("t-cancel-note").textContent = all.length ? `${fmt((cancelled.length / all.length) * 100)}% of scheduled` : "";

  renderRanking(all);
  renderFlightTable(all);
}

function renderRanking(flights) {
  const metric = RANK_METRICS[$("rank-by").value];
  const minFlights = Number($("rank-min").value);
  const rows = rankAirlines(flights)
    .filter((r) => r.flights >= minFlights)
    .sort((a, b) => metric.value(b) - metric.value(a) || b.totalMin - a.totalMin || b.flights - a.flights);
  const top = rows.slice(0, RANK_CHART_LIMIT);
  const max = Math.max(...top.map(metric.value), 0);

  $("rank-chart").innerHTML = max === 0
    ? `<div class="list-note">${rows.length ? "No delays recorded for these airlines." : "Not enough flights with times to rank airlines."}</div>`
    : top.map((r, i) => `
      <div class="bar-row" data-i="${i}">
        <span class="rank">${i + 1}</span>
        <span class="name" title="${esc(r.name)}">${esc(r.name)}</span>
        <span class="track"><div class="fill" style="width:${(metric.value(r) / max) * 100}%"></div></span>
        <span class="val">${metric.fmt(metric.value(r))}</span>
      </div>`).join("");
  $("rank-chart").setAttribute("aria-label", `Top ${top.length} airlines by ${metric.label.toLowerCase()}`);
  $("rank-chart")._rows = top;

  $("rank-table").innerHTML = rows.map((r, i) => `
    <tr>
      <td class="num muted">${i + 1}</td>
      <td>${esc(r.name)}${r.code ? ` <span class="muted">${esc(r.code)}</span>` : ""}</td>
      <td class="num">${fmt(r.flights)}</td>
      <td class="num">${fmt(r.delayed)}</td>
      <td class="num">${fmt((r.delayed / r.flights) * 100)}%</td>
      <td class="num">${fmtDuration(r.totalMin / r.flights)}</td>
      <td class="num">${fmtDuration(r.totalMin)}</td>
      <td class="num ${r.worst?.delayMin >= DELAYED_MIN ? "late" : ""}">${r.worst && r.worst.delayMin > 0 ? fmtDuration(r.worst.delayMin) : "–"}</td>
      <td class="num">${fmt(r.cancelled)}</td>
    </tr>`).join("") || `<tr><td colspan="9" class="muted">No airlines with at least ${minFlights} flight${minFlights === 1 ? "" : "s"} with times.</td></tr>`;

  $("rank-note").textContent = `Delayed = ${DELAYED_MIN}+ min late against schedule. Early flights count as 0 delay. ` +
    `Only airlines with ${minFlights}+ flights with times are ranked; codeshares are counted once, under the operating airline. ` +
    `Includes estimated times for flights that haven't operated yet.`;
}

function renderFlightTable(flights) {
  const f = $("delay-filter").value.trim().toLowerCase();
  const delayedOnly = $("delayed-only").checked;
  const rows = flights
    .filter((x) => !delayedOnly || x.delayMin >= DELAYED_MIN)
    .filter((x) => !f || [x.number, x.airline?.name, x.other?.iata, x.other?.icao, x.other?.name].some((v) => v && v.toLowerCase().includes(f)))
    .sort((a, b) => (b.delayMin ?? -Infinity) - (a.delayMin ?? -Infinity) || (a.scheduled ?? 0) - (b.scheduled ?? 0));

  $("flight-table").innerHTML = rows.slice(0, FLIGHT_TABLE_LIMIT).map((x) => {
    const where = x.other ? `${x.direction === "Arrival" ? "from" : "to"} ${esc(x.other.iata || x.other.icao || "")} <span class="muted">${esc(x.other.name ?? "")}</span>` : "–";
    const d = x.delayMin;
    const cls = d == null ? "muted" : delayClass(d);
    const status = x.cancelled ? `<span class="pill bad">Cancelled</span>` : `<span class="pill">${esc(x.statusInferred ? "Landed (time not reported)" : x.status ?? "Unknown")}</span>`;
    return `<tr>
      <td><b>${esc(x.number ?? "–")}</b>${x.cargo ? ` <span class="muted">cargo</span>` : ""}</td>
      <td>${esc(x.airline?.name ?? "–")}</td>
      <td>${where}</td>
      <td class="num">${esc(x.scheduledLocal ?? "–")}</td>
      <td class="num">${x.bestLocal ? `${esc(x.bestLocal)} <span class="muted">${x.actual ? "act." : "est."}</span>` : "–"}</td>
      <td class="num ${cls}">${d == null ? "–" : fmtDelay(d)}</td>
      <td>${status}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="7" class="muted">No flights match.</td></tr>`;

  $("flight-note").textContent = (rows.length > FLIGHT_TABLE_LIMIT ? `Showing the ${FLIGHT_TABLE_LIMIT} most delayed of ${fmt(rows.length)}. ` : "") +
    `Times are local at ${state.data.airport}. Delay = estimated or actual gate time minus scheduled; + is late, - is early.`;
}

function onChartHover(e) {
  const row = e.target.closest(".bar-row");
  const tip = $("chart-tip");
  const r = row && $("rank-chart")._rows?.[row.dataset.i];
  if (!r) return void (tip.hidden = true);
  tip.innerHTML = `<b>${esc(r.name)}</b><br>
    <span class="k">Flights</span> ${fmt(r.flights)} · <span class="k">delayed 15+</span> ${fmt(r.delayed)} (${fmt((r.delayed / r.flights) * 100)}%)<br>
    <span class="k">Total delay</span> ${fmtDuration(r.totalMin)} · <span class="k">avg</span> ${fmtDuration(r.totalMin / r.flights)}<br>
    ${r.worst && r.worst.delayMin > 0 ? `<span class="k">Worst</span> ${esc(r.worst.number ?? "")} ${fmtDelay(r.worst.delayMin)}<br>` : ""}
    <span class="k">Cancelled</span> ${fmt(r.cancelled)}`;
  tip.hidden = false;
  const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
  const y = e.clientY + 14 + tip.offsetHeight > window.innerHeight ? e.clientY - tip.offsetHeight - 10 : e.clientY + 14;
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}

// First visit to the tab loads the last-used airport.
export function setDelaysActive(isActive) {
  state.active = isActive;
  if (isActive && !state.data && !state.loading) loadDelays($("delay-airport").value || storage.get("ft-delay-airport", "LHR"));
}

export function initDelays() {
  $("delay-airport").value = storage.get("ft-delay-airport", "LHR");
  $("rank-chart").addEventListener("mousemove", onChartHover);
  $("rank-chart").addEventListener("mouseleave", () => { $("chart-tip").hidden = true; });
  $("delay-form").addEventListener("submit", (e) => { e.preventDefault(); loadDelays($("delay-airport").value); });
  document.querySelectorAll(".seg [data-dir]").forEach((b) => b.addEventListener("click", () => {
    state.direction = b.dataset.dir;
    document.querySelectorAll(".seg [data-dir]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    render();
  }));
  $("rank-by").addEventListener("change", render);
  $("rank-min").addEventListener("change", render);
  $("delay-filter").addEventListener("input", () => state.data && renderFlightTable(inDirection(state.data.flights)));
  $("delayed-only").addEventListener("change", render);
  // Re-poll while the tab is open so the board stays current.
  setInterval(() => { if (state.active && !document.hidden && state.airport && !state.loading) loadDelays(state.airport); }, REFRESH_MS);
}
