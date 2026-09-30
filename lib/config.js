// All settings come from environment variables, read once here.
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const env = process.env;

export const PORT = Number(env.PORT ?? 3100);
export const PUBLIC_DIR = path.join(root, "public");

// adsb.lol rejects generic User-Agents and asks for contact info.
// Set ADSB_CONTACT (an email or URL) to identify yourself to them.
export const USER_AGENT = `flight-tracker/1.0 (personal non-commercial map${env.ADSB_CONTACT ? `; contact: ${env.ADSB_CONTACT}` : ""})`;

// Schedules, delays and aircraft rotations. Free key from rapidapi.com/aedbx-aedbx/api/aerodatabox.
export const AERODATABOX_KEY = env.AERODATABOX_KEY || null;

// Local history database of observed flights (SQLite).
export const DB_FILE = env.DB_FILE ?? path.join(root, "data", "flights.db");

// Optional background collection of airport history, e.g. COLLECT_AIRPORTS=BLR,DEL.
// Off by default: each airport costs 2 AeroDataBox FIDS calls per run (about 4 quota units).
export const COLLECT_AIRPORTS = (env.COLLECT_AIRPORTS ?? "")
  .split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z0-9]{3,4}$/.test(s));
export const COLLECT_INTERVAL_HOURS = Math.max(1, Number(env.COLLECT_INTERVAL_HOURS ?? 12));
