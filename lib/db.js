// The app's one history database. Kept separate from store.js so tests can open their own.
import { DB_FILE } from "./config.js";
import { openStore } from "./store.js";

export const history = openStore(DB_FILE);

// Recording history must never break the request that happened to produce it.
export function record(rows) {
  try {
    if (rows.length) history.saveMovements(rows);
  } catch (error) {
    console.warn(`history not saved: ${error.message}`);
  }
}
