// The Map tab: live aircraft on the map, the sidebar list, and the selected aircraft's details.
import { renderChain } from "./chain.js";
import { $, getJson, storage } from "./dom.js";
import { airportCode, delayClass, esc, fmt, fmtClock, fmtDelay } from "./format.js";

const REFRESH_MS = 10000;
const FLIGHT_INFO_MAX_AGE_MS = 3 * 60 * 1000; // re-ask the server (which caches for 15 min) this often
const MAX_RADIUS_NM = 250;
const LIST_LIMIT = 150;
const TRAIL_POINTS = 400;
const EMERGENCY_LABELS = { hijack: "Hijack (7500)", "radio failure": "Radio failure (7600)", "general emergency": "Emergency (7700)" };
const PLANE_PATH = "M12 1.5c.8 0 1.4.9 1.4 2.2v5.2l8.1 4.7v2.1l-8.1-2.4v4.8l2.4 1.8v1.7L12 20.7l-3.8.9v-1.7l2.4-1.8v-4.8l-8.1 2.4v-2.1l8.1-4.7V3.7c0-1.3.6-2.2 1.4-2.2z";

// ---------- altitude colour bands ----------
const BANDS = [
  { max: 5000, cls: "1", label: "Below 5,000 ft" },
  { max: 15000, cls: "2", label: "5,000 – 15,000 ft" },
  { max: 25000, cls: "3", label: "15,000 – 25,000 ft" },
  { max: 35000, cls: "4", label: "25,000 – 35,000 ft" },
  { max: Infinity, cls: "5", label: "35,000 ft and above" },
];
const altColor = (a) => {
  if (a.onGround) return "var(--alt-ground)";
  if (a.altitude == null) return "var(--alt-3)";
  return `var(--alt-${BANDS.find((b) => a.altitude < b.max).cls})`;
};

// ---------- state ----------
let map;
const aircraft = new Map();   // hex -> latest record
const markers = new Map();    // hex -> Leaflet marker
const trails = new Map();     // hex -> [[lat, lon], ...]
const flightInfo = new Map(); // "hex|callsign" -> { at, loading } | { at, data } | { at, error }
let selectedHex = null;
let trailLine = null;
let lastUpdate = null;
let failed = false;
let retryAt = null;
let inflight = null;
let filterText = "";
let follow = true;
let active = true;
let airlineNames = {};        // ICAO code -> airline name, loaded once from /api/airlines
let pendingSelectHex = null;  // aircraft to select once it appears in the map data (from Find flight)
let openDelays = () => {};

// Airline callsigns are a 3-letter ICAO code plus a flight number (BAW117, EIN3YR).
const airlineOf = (a) => airlineNames[a.callsign?.match(/^([A-Z]{3})\d/)?.[1]] ?? null;

// ---------- markers ----------
function planeHtml(a) {
  const cls = ["plane", a.hex === selectedHex ? "selected" : "", a.emergency ? "emergency" : ""].join(" ");
  return `<div class="${cls}" style="transform:rotate(${a.track ?? 0}deg)">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="${PLANE_PATH}" fill="${altColor(a)}"/></svg></div>`;
}

function tooltipHtml(a) {
  return `<strong>${esc(a.callsign || a.hex.toUpperCase())}</strong>${a.type ? ` · ${esc(a.type)}` : ""}<br>` +
    (a.onGround ? "On the ground" : `${fmt(a.altitude)} ft · ${fmt(a.groundSpeed)} kt`);
}

function upsertMarker(a) {
  let m = markers.get(a.hex);
  const icon = L.divIcon({ className: "plane-icon", html: planeHtml(a), iconSize: [26, 26], iconAnchor: [13, 13] });
  if (!m) {
    m = L.marker([a.lat, a.lon], { icon, keyboard: false, zIndexOffset: a.emergency ? 1000 : 0 })
      .bindTooltip("", { direction: "top", offset: [0, -12] })
      .on("click", () => select(a.hex, true))
      .addTo(map);
    markers.set(a.hex, m);
  } else {
    m.setLatLng([a.lat, a.lon]);
    const el = m.getElement()?.querySelector(".plane");
    // Update in place so the rotation animates instead of the icon being rebuilt.
    if (el) {
      el.className = ["plane", a.hex === selectedHex ? "selected" : "", a.emergency ? "emergency" : ""].join(" ");
      el.style.transform = `rotate(${a.track ?? 0}deg)`;
      el.querySelector("path").setAttribute("fill", altColor(a));
    } else {
      m.setIcon(icon);
    }
  }
  m.setZIndexOffset(a.hex === selectedHex ? 2000 : a.emergency ? 1000 : 0);
  m.setTooltipContent(tooltipHtml(a));
}

// ---------- data ----------
function queryArea() {
  const center = map.getCenter();
  const corner = map.getBounds().getNorthEast();
  const dist = center.distanceTo(corner) / 1852; // metres -> nautical miles
  return { lat: center.lat, lon: L.Util.wrapNum(center.lng, [-180, 180], true), dist: Math.max(5, dist) };
}

export async function refresh() {
  if (document.hidden || !active) return;
  inflight?.abort();
  const controller = new AbortController();
  inflight = controller;
  const q = queryArea();

  try {
    const { ok, status, data } = await getJson(`/api/aircraft?lat=${q.lat}&lon=${q.lon}&dist=${q.dist.toFixed(1)}`, { signal: controller.signal });
    retryAt = data.retryAt ?? null;
    if (!ok) throw new Error(data.error || `HTTP ${status}`);
    applyData(data.aircraft);
    const note = $("view-note");
    note.hidden = q.dist <= MAX_RADIUS_NM;
    note.textContent = `Showing aircraft within ${MAX_RADIUS_NM} nm of the map centre — zoom in to see everything in view.`;
    lastUpdate = Date.now();
    failed = false;
  } catch (err) {
    if (err.name === "AbortError") return;
    failed = true;
    console.error(err);
  } finally {
    if (inflight === controller) inflight = null;
    renderStatus();
  }
}

function applyData(list) {
  const seenNow = new Set();
  for (const a of list) {
    seenNow.add(a.hex);
    aircraft.set(a.hex, a);
    const trail = trails.get(a.hex) ?? [];
    const last = trail[trail.length - 1];
    if (!last || last[0] !== a.lat || last[1] !== a.lon) trail.push([a.lat, a.lon]);
    if (trail.length > TRAIL_POINTS) trail.shift();
    trails.set(a.hex, trail);
    upsertMarker(a);
  }
  for (const hex of [...aircraft.keys()]) {
    if (seenNow.has(hex)) continue;
    markers.get(hex)?.remove();
    markers.delete(hex);
    if (hex !== selectedHex) { aircraft.delete(hex); trails.delete(hex); }
  }
  if (pendingSelectHex && seenNow.has(pendingSelectHex)) {
    select(pendingSelectHex, true);
    pendingSelectHex = null;
  }
  renderSidebar();
  renderDetails();
  if (selectedHex && follow && seenNow.has(selectedHex)) {
    const a = aircraft.get(selectedHex);
    if (!map.getBounds().pad(-0.2).contains([a.lat, a.lon])) map.panTo([a.lat, a.lon]);
  }
}

// ---------- selection ----------
function select(hex, fromMap = false) {
  const prev = selectedHex;
  selectedHex = hex;
  follow = true;
  $("d-follow").checked = true;
  for (const h of [prev, hex]) { const a = h && aircraft.get(h); if (a && markers.has(h)) upsertMarker(a); }
  const a = aircraft.get(hex);
  if (a && !fromMap) map.panTo([a.lat, a.lon]);
  renderDetails();
  renderSidebar();
}

function clearSelection() {
  const prev = selectedHex;
  selectedHex = null;
  if (prev && !markers.has(prev)) { aircraft.delete(prev); trails.delete(prev); }
  const a = prev && aircraft.get(prev);
  if (a) upsertMarker(a);
  renderDetails();
  renderSidebar();
}

// From another tab: select this aircraft as soon as the map has loaded it.
export function showAircraft(live) {
  pendingSelectHex = live.hex;
  map.setView([live.lat, live.lon], 8);
}

// ---------- schedule, STA / ETA / delay, and the aircraft's day ----------
const flightKey = (a) => `${a.hex}|${a.callsign ?? ""}`;

async function loadFlightInfo(a) {
  const key = flightKey(a);
  const known = flightInfo.get(key);
  if (known && (known.loading || Date.now() - known.at < FLIGHT_INFO_MAX_AGE_MS)) return;
  flightInfo.set(key, { ...known, at: Date.now(), loading: !known?.data }); // keep showing old data while refreshing
  try {
    // Position, speed and type let the server estimate an ETA and turnaround when the airline hasn't.
    const params = new URLSearchParams({ hex: a.hex, lat: a.lat, lon: a.lon, ground: a.onGround ? "1" : "0" });
    if (a.callsign) params.set("callsign", a.callsign);
    if (a.groundSpeed != null) params.set("gs", a.groundSpeed);
    if (a.type) params.set("type", a.type);
    const { ok, status, data } = await getJson(`/api/flight?${params}`);
    if (!ok) throw new Error(data.error || `HTTP ${status}`);
    flightInfo.set(key, { at: Date.now(), data });
  } catch (err) {
    flightInfo.set(key, known?.data ? { ...known, at: Date.now() } : { at: Date.now(), error: err.message || "Lookup failed" });
  }
  if (selectedHex === a.hex) renderDetails();
}

function distanceNm(lat1, lon1, lat2, lon2) {
  return L.latLng(lat1, lon1).distanceTo([lat2, lon2]) / 1852;
}

function renderSchedule(a) {
  const info = flightInfo.get(flightKey(a));
  const data = info?.data;
  const dest = data?.destination;
  const tz = dest?.timeZone;
  const set = (id, text, cls = "") => { $(id).textContent = text; $(id).className = cls; };

  // Airline and flight number, e.g. "British Airways · BA 117"
  const airline = data?.airline?.name;
  $("d-airline").hidden = !airline;
  $("d-airline").innerHTML = airline ? `${esc(airline)}${data.number ? ` <span class="num">· ${esc(data.number)}</span>` : ""}` : "";

  // Route line
  const hasRoute = Boolean(data?.origin && dest);
  $("d-route").innerHTML = hasRoute
    ? `${esc(airportCode(data.origin))} → ${esc(airportCode(dest))} <span class="city">${esc([data.origin.city, dest.city].filter(Boolean).join(" → "))}</span>`
    : !info || info.loading ? "Looking up route…" : "No scheduled route";

  // ETA: airline/AeroDataBox figure if we have one, else distance-to-go ÷ ground speed.
  let eta = data?.eta ?? null;
  let estimated = false;
  if (eta == null && dest?.lat != null && !a.onGround && a.groundSpeed > 50) {
    eta = Date.now() + (distanceNm(a.lat, a.lon, dest.lat, dest.lon) / a.groundSpeed) * 3600000;
    estimated = true;
  }
  const arrived = data?.status === "Arrived";
  $("d-eta-label").textContent = arrived ? "ATA" : "ETA";
  set("d-sta", fmtClock(data?.sta, tz));
  set("d-eta", eta == null ? "–" : fmtClock(eta, tz) + (estimated ? " est." : ""));

  if (data?.sta != null && eta != null) {
    const mins = Math.round((eta - data.sta) / 60000);
    const label = mins > 0 ? "late" : mins < 0 ? "early" : "on time";
    set("d-delay", `${fmtDelay(mins)} ${label}`, delayClass(mins));
  } else {
    set("d-delay", "–");
  }

  // With nothing to show, drop the empty STA/ETA/Delay grid and say why instead.
  const nothingKnown = !hasRoute && data?.sta == null && eta == null;
  document.querySelector(".sched dl").hidden = Boolean(info && !info.loading && nothingKnown);

  const notes = [];
  if (info?.error) notes.push(`Lookup failed: ${info.error}`);
  else if (data && nothingKnown) {
    notes.push(a.callsign
      ? `No published route or schedule for ${a.callsign}. That's normal for private, military, charter and training flights and for airport vehicles; STA and ETA only exist for scheduled airline flights.`
      : "This aircraft isn't broadcasting a callsign, so its route can't be looked up.");
  }
  else if (data && !data.scheduleAvailable) notes.push("STA and the aircraft's day need an AeroDataBox key (set AERODATABOX_KEY on the server).");
  else if (data && data.sta == null) notes.push("No schedule found for this flight.");
  if (estimated) notes.push("ETA estimated from distance to go and current ground speed.");
  if (eta != null || data?.sta != null) notes.push(tz ? `Times local at ${airportCode(dest)}.` : "Times in UTC.");
  $("d-sched-note").textContent = notes.join(" ");

  const destCode = dest?.iata || dest?.icao;
  $("d-to-delays").hidden = !destCode;
  $("d-to-delays").textContent = destCode ? `See delays at ${destCode} →` : "";
  $("d-to-delays").dataset.airport = destCode ?? "";

  // Keep open/closed prediction cards as the user left them across the 10 s re-renders.
  const chainEl = $("d-chain");
  const openCards = [...chainEl.querySelectorAll("details")].map((d) => d.open);
  const html = renderChain(data?.chain, data?.aircraft ?? {});
  chainEl.hidden = !html;
  if (chainEl.dataset.html !== html) {
    chainEl.innerHTML = html;
    chainEl.dataset.html = html;
    if (openCards.length) chainEl.querySelectorAll("details").forEach((d, i) => { if (i < openCards.length) d.open = openCards[i]; });
  }
}

function renderDetails() {
  const a = selectedHex && aircraft.get(selectedHex);
  $("details").hidden = !a;
  trailLine?.remove();
  trailLine = null;
  if (!a) return;

  $("d-callsign").textContent = a.callsign || a.hex.toUpperCase();
  $("d-sub").textContent = [a.registration, a.description || a.type].filter(Boolean).join(" · ") || "Unknown aircraft";
  $("d-emergency").innerHTML = a.emergency ? `<span class="badge">⚠ ${esc(EMERGENCY_LABELS[a.emergency] ?? a.emergency)}</span>` : "";
  loadFlightInfo(a); // no-op while fresh; catches a callsign that appears after selection
  renderSchedule(a);
  $("d-alt").textContent = a.onGround ? "On the ground" : a.altitude == null ? "–" : `${fmt(a.altitude)} ft`;
  const vs = a.verticalRate;
  $("d-vs").textContent = vs == null || a.onGround ? "–" : Math.abs(vs) < 100 ? "Level" : `${vs > 0 ? "▲ Climbing" : "▼ Descending"} ${fmt(Math.abs(vs))} ft/min`;
  $("d-speed").textContent = a.groundSpeed == null ? "–" : `${fmt(a.groundSpeed)} kt (${fmt(a.groundSpeed * 1.852)} km/h)`;
  $("d-track").textContent = a.track == null ? "–" : `${fmt(a.track)}°`;
  $("d-squawk").textContent = a.squawk ?? "–";
  $("d-hex").textContent = a.hex.toUpperCase();
  $("d-link").href = `https://adsb.lol/?icao=${encodeURIComponent(a.hex)}`;
  const lost = !markers.has(a.hex);
  $("d-lost").hidden = !lost;
  $("d-lost").textContent = lost ? "No longer in the area being tracked. Showing its last known data." : "";

  const trail = trails.get(a.hex);
  if (trail?.length > 1) {
    trailLine = L.polyline(trail, { color: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(), weight: 2, opacity: 0.85, interactive: false }).addTo(map);
  }
}

// ---------- sidebar ----------
function renderSidebar() {
  const bounds = map.getBounds();
  const center = map.getCenter();
  const inView = [...aircraft.values()].filter((a) => markers.has(a.hex) && bounds.contains([a.lat, a.lon]));
  const emergencies = inView.filter((a) => a.emergency).length;
  $("stat-view").textContent = fmt(inView.length);
  $("stat-air").textContent = fmt(inView.filter((a) => !a.onGround).length);
  $("stat-emerg").textContent = fmt(emergencies);
  $("stat-emerg").classList.toggle("critical", emergencies > 0);

  const f = filterText.toLowerCase();
  const matches = inView
    .filter((a) => !f || [a.callsign, a.registration, a.type, a.hex, a.description, airlineOf(a)].some((v) => v && v.toLowerCase().includes(f)))
    .map((a) => ({ a, d: center.distanceTo([a.lat, a.lon]) }))
    .sort((x, y) => (y.a.emergency ? 1 : 0) - (x.a.emergency ? 1 : 0) || x.d - y.d);

  $("list-note").textContent = matches.length > LIST_LIMIT
    ? `Showing the ${LIST_LIMIT} closest to the map centre of ${fmt(matches.length)}`
    : matches.length ? "Closest to the map centre first" : "";

  $("list").innerHTML = matches.length === 0
    ? `<li class="empty">${aircraft.size ? "No aircraft match." : "Waiting for data…"}</li>`
    : matches.slice(0, LIST_LIMIT).map(({ a }) => `
      <li data-hex="${esc(a.hex)}" class="${a.hex === selectedHex ? "selected" : ""}">
        <span class="swatch" style="background:${a.emergency ? "var(--critical)" : altColor(a)}"></span>
        <div class="who">
          <div class="cs">${esc(a.callsign || a.hex.toUpperCase())} ${a.emergency ? `<span class="badge">⚠ ${esc(a.squawk ?? "")}</span>` : ""}</div>
          ${airlineOf(a) ? `<div class="airline-name">${esc(airlineOf(a))}</div>` : ""}
          <div class="meta">${esc([a.type, a.registration].filter(Boolean).join(" · ") || "Unknown type")}</div>
        </div>
        <div class="nums">${a.onGround ? "Ground" : `${fmt(a.altitude)} ft`}<br><span class="meta">${fmt(a.groundSpeed)} kt</span></div>
      </li>`).join("");
}

function renderStatus() {
  const el = $("status");
  el.classList.toggle("error", failed);
  el.classList.toggle("paused", document.hidden);
  if (document.hidden) return void ($("status-text").textContent = "Paused");
  if (failed && retryAt > Date.now()) {
    return void ($("status-text").textContent = `adsb.lol is rate-limiting, retrying in ${Math.ceil((retryAt - Date.now()) / 1000)}s`);
  }
  if (failed) return void ($("status-text").textContent = "Can't reach adsb.lol, retrying…");
  if (!lastUpdate) return void ($("status-text").textContent = "Connecting…");
  const s = Math.round((Date.now() - lastUpdate) / 1000);
  $("status-text").textContent = `Live · updated ${s <= 1 ? "just now" : `${s}s ago`}`;
}

// Polling stops while another tab is showing.
export function setTrackerActive(isActive) {
  active = isActive;
  if (active) {
    map.invalidateSize();
    refresh();
  }
}

// ---------- setup ----------
function createMap() {
  let saved = null;
  try { saved = JSON.parse(storage.get("ft-view")); } catch {}
  map = L.map("map", { zoomControl: true, worldCopyJump: true })
    .setView(saved ? [saved.lat, saved.lon] : [51.47, -0.45], saved?.zoom ?? 9);

  // OpenStreetMap's standard tiles need no API key. Dark mode is done with a CSS filter on the tile pane.
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · Flight data <a href="https://adsb.lol">adsb.lol</a> (ODbL)',
  }).addTo(map);

  const legend = L.control({ position: "bottomleft" });
  legend.onAdd = () => {
    const div = L.DomUtil.create("div", "legend");
    div.innerHTML = `<div class="title">Altitude</div>` +
      BANDS.slice().reverse().map((b) => `<div class="row"><span class="sw" style="background:var(--alt-${b.cls})"></span>${b.label}</div>`).join("") +
      `<div class="row"><span class="sw" style="background:var(--alt-ground)"></span>On the ground</div>` +
      `<div class="row"><span class="sw" style="background:var(--critical)"></span>Emergency squawk</div>`;
    return div;
  };
  legend.addTo(map);

  const viewNote = L.control({ position: "topright" });
  viewNote.onAdd = () => { const d = L.DomUtil.create("div", "view-note"); d.id = "view-note"; d.hidden = true; return d; };
  viewNote.addTo(map);
}

// onOpenDelays(airportCode): called when the user follows "See delays at …".
export function initTracker({ onOpenDelays }) {
  openDelays = onOpenDelays;
  createMap();

  getJson("/api/airlines")
    .then(({ ok, data }) => { if (ok) { airlineNames = data; renderSidebar(); } })
    .catch(() => {}); // the list just shows without airline names

  $("list").addEventListener("click", (e) => {
    const li = e.target.closest("li[data-hex]");
    if (li) select(li.dataset.hex);
  });
  $("d-close").addEventListener("click", clearSelection);
  $("d-follow").addEventListener("change", (e) => { follow = e.target.checked; });
  $("filter-input").addEventListener("input", (e) => { filterText = e.target.value.trim(); renderSidebar(); });
  $("d-to-delays").addEventListener("click", (e) => {
    e.preventDefault();
    openDelays(e.currentTarget.dataset.airport);
  });

  map.on("dragstart", () => { if (selectedHex) { follow = false; $("d-follow").checked = false; } });
  let moveTimer;
  map.on("moveend", () => {
    const c = map.getCenter();
    storage.set("ft-view", JSON.stringify({ lat: c.lat, lon: c.lng, zoom: map.getZoom() }));
    renderSidebar();
    clearTimeout(moveTimer);
    moveTimer = setTimeout(refresh, 400);
  });

  $("search-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = $("search-input").value.trim();
    if (!q) return;
    $("search-msg").hidden = true;
    try {
      const { ok, data } = await getJson(`/api/place?q=${encodeURIComponent(q)}`);
      if (!ok) throw new Error(data.error);
      map.setView([data.lat, data.lon], 9);
    } catch (err) {
      $("search-msg").textContent = err.message || "Search failed";
      $("search-msg").hidden = false;
    }
  });

  $("locate-btn").addEventListener("click", () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => map.setView([pos.coords.latitude, pos.coords.longitude], 9),
      () => { $("search-msg").textContent = "Couldn't get your location"; $("search-msg").hidden = false; },
    );
  });

  document.addEventListener("visibilitychange", () => { renderStatus(); if (!document.hidden) refresh(); });
  setInterval(refresh, REFRESH_MS);
  setInterval(renderStatus, 1000);
}
