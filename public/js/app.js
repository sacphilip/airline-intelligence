// Page entry point: sets up each tab and switches between them.
import { $ } from "./dom.js";
import { initDelays, loadDelays, setDelaysActive } from "./delays.js";
import { focusFlightSearch, initFlightSearch, openFlight } from "./flight-search.js";
import { initTracker, setTrackerActive, showAircraft } from "./tracker.js";

const TABS = ["map", "flight", "delays"];

function switchTab(tab) {
  const active = TABS.includes(tab) ? tab : "map";
  document.querySelectorAll(".tabs [data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === active)));
  document.querySelector("main").hidden = active !== "map";
  $("flight-view").hidden = active !== "flight";
  $("delays-view").hidden = active !== "delays";
  $("search-form").hidden = active !== "map";
  $("status").hidden = active !== "map";
  $("search-msg").hidden = true;
  history.replaceState?.(null, "", active === "map" ? location.pathname + location.search : `#${active}`);

  setTrackerActive(active === "map");
  setDelaysActive(active === "delays");
  if (active === "flight") focusFlightSearch();
}

initTracker({
  onOpenDelays: (airport) => {
    loadDelays(airport);
    switchTab("delays");
  }
});
initFlightSearch({
  onShowOnMap: (live) => {
    switchTab("map");
    showAircraft(live);
  }
});
initDelays();

// Addresses: #map (default), #delays, #flight, or #flight/<number>[/<YYYY-MM-DD>] for one flight's page.
function followHash() {
  let parts;
  try { parts = location.hash.slice(1).split("/").map(decodeURIComponent); } catch { parts = []; } // malformed % escapes
  const [tab, number, date] = parts;
  switchTab(tab);
  if (tab === "flight" && number) openFlight(number, date);
}

document.querySelectorAll(".tabs [data-tab]").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
window.addEventListener("hashchange", followHash); // a pasted or edited link, in the same page
followHash();
