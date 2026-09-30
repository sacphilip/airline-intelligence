// Import this first in any test that loads lib/db.js (directly or through a feature module), so
// the app's history database points at a throwaway file instead of data/flights.db.
import os from "node:os";
import path from "node:path";

process.env.DB_FILE = path.join(os.tmpdir(), `flight-tracker-test-${process.pid}.db`);
