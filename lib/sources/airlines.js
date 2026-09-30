// Airline names by code (e.g. BAW -> British Airways), from the Virtual Radar Server standing data
// that adsb.lol's route database is built on. Loaded once, refreshed daily.
import { USER_AGENT } from "../config.js";
import { TtlCache } from "../cache.js";

const AIRLINES_CSV = "https://raw.githubusercontent.com/vradarserver/standing-data/main/airlines/schema-01/airlines.csv";
const cache = new TtlCache(24 * 60 * 60 * 1000);
const EMPTY = { byIcao: new Map(), byIata: new Map() };

export function parseCsvLine(line) {
  const fields = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { fields.push(field); field = ""; }
    else field += c;
  }
  fields.push(field);
  return fields;
}

export function parseAirlines(csv) {
  const byIcao = new Map(); // ICAO -> { name, iata }
  const byIata = new Map(); // IATA -> [ICAO, ...]; several airlines can share one (BA: BAW and SHT)
  const [header, ...rows] = csv.replace(/^﻿/, "").split(/\r?\n/);
  const cols = parseCsvLine(header);
  const [iName, iIcao, iIata] = ["Name", "ICAO", "IATA"].map((c) => cols.indexOf(c));
  for (const row of rows) {
    if (!row) continue;
    const f = parseCsvLine(row);
    if (!f[iIcao] || byIcao.has(f[iIcao])) continue;
    byIcao.set(f[iIcao], { name: f[iName].replace(/&amp;/g, "&"), iata: f[iIata] || null });
    if (f[iIata]) byIata.set(f[iIata], [...(byIata.get(f[iIata]) ?? []), f[iIcao]]);
  }
  return { byIcao, byIata };
}

async function load() {
  try {
    return await cache.getOrLoad("all", async () => {
      const response = await fetch(AIRLINES_CSV, { headers: { "User-Agent": USER_AGENT } });
      if (!response.ok) throw new Error(`airline list request failed (${response.status})`);
      return parseAirlines(await response.text());
    });
  } catch (error) {
    console.warn(error.message);
    return EMPTY; // names are a nicety; carry on without them and try again next time
  }
}

export async function airlineNames() {
  const { byIcao } = await load();
  return Object.fromEntries([...byIcao].map(([icao, a]) => [icao, a.name]));
}

export async function lookupAirline(icao) {
  if (!icao || !/^[A-Z]{3}$/.test(icao)) return null;
  const airline = (await load()).byIcao.get(icao);
  return airline ? { icao, iata: airline.iata, name: airline.name } : null;
}

export async function icaoCodesForIata(iata) {
  return (await load()).byIata.get(iata) ?? [];
}
