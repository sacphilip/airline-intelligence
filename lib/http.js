// HTTP helpers: JSON responses, request-parameter parsing and static files.
import fs from "node:fs";
import path from "node:path";

// Thrown by handlers to send a specific status; `extra` fields are merged into the JSON body.
export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// Returned by a handler that needs response headers beyond the JSON default.
export class Reply {
  constructor(body, headers = {}) {
    this.body = body;
    this.headers = headers;
  }
}

export const needsKey =(what) => new HttpError(503, `${what} needs an AeroDataBox key`, { needsKey: true });

export function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

export function numberParam(params, name, min, max, fallback = null) {
  const raw = params.get(name);
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

export function airportParam(params, name, message = "Enter a 3-letter IATA or 4-letter ICAO airport code") {
  const code = params.get(name)?.trim().toUpperCase() ?? "";
  if (!/^[A-Z0-9]{3,4}$/.test(code)) throw new HttpError(400, message);
  return code;
}

export function dateParam(params, name, { required = false } = {}) {
  const date = params.get(name) ?? "";
  if (!date && !required) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00Z`))) throw new HttpError(400, "Enter a valid date");
  return date;
}

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

// Serve a file from `root`; returns false when there is no such file (so the caller can 404).
export function serveStatic(root, pathname, res) {
  const relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  const file = path.resolve(root, relative);
  if (!file.startsWith(path.resolve(root) + path.sep)) return false; // no escaping the public folder
  const type = CONTENT_TYPES[path.extname(file)];
  if (!type || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  // No caching: this is a local app under active development, and files are small.
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
  fs.createReadStream(file).pipe(res);
  return true;
}
