import { createServer, IncomingMessage, ServerResponse } from 'http';

// Static OpenAPI schema returned by GET /api-docs-json.
// Phase 2 of the orchestrator reads this to discover endpoints and parameters.
const OPENAPI_SCHEMA = {
  openapi: '3.0.0',
  info: { title: 'Flight Tracker API (Mock)', version: '1.0.0' },
  paths: {
    '/api/search': {
      get: {
        summary: 'Search flights by flight number',
        parameters: [
          { name: 'number', in: 'query', required: true,  schema: { type: 'string' }, description: 'IATA flight number (max 10 chars)' },
          { name: 'date',   in: 'query', required: false, schema: { type: 'string' }, description: 'Date (YYYY-MM-DD)' },
        ],
      },
    },
    '/api/route': {
      get: {
        summary: 'Get flights between two airports on a date',
        parameters: [
          { name: 'from', in: 'query', required: true,  schema: { type: 'string' }, description: 'Origin airport IATA code (3 chars)' },
          { name: 'to',   in: 'query', required: true,  schema: { type: 'string' }, description: 'Destination airport IATA code (3 chars)' },
          { name: 'date', in: 'query', required: true,  schema: { type: 'string' }, description: 'Date (YYYY-MM-DD)' },
        ],
      },
    },
    '/api/flight/history': {
      get: {
        summary: 'Get historical flights for a flight number',
        parameters: [
          { name: 'number', in: 'query', required: true,  schema: { type: 'string' }, description: 'IATA flight number' },
          { name: 'days',   in: 'query', required: false, schema: { type: 'integer' }, description: 'Number of days of history to return' },
        ],
      },
    },
    '/api/airline/profile': {
      get: {
        summary: 'Get airline profile',
        parameters: [
          { name: 'iata', in: 'query', required: true, schema: { type: 'string' }, description: 'Airline IATA code (2 chars, e.g. AA, 6E)' },
        ],
      },
    },
    '/api/airline/rankings': {
      get: {
        summary: 'Get airline rankings',
        parameters: [],
      },
    },
    '/api/airline/trend': {
      get: {
        summary: 'Get airline trend data',
        parameters: [
          { name: 'iata',   in: 'query', required: true,  schema: { type: 'string' }, description: 'Airline IATA code' },
          { name: 'months', in: 'query', required: false, schema: { type: 'string' }, description: 'Number of months to include' },
        ],
      },
    },
  },
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function q(url: URL, name: string): string | null {
  return url.searchParams.get(name);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(payload);
}

function bad(res: ServerResponse, message: string): void {
  json(res, 400, { error: 'Bad Request', message });
}

function route(url: URL, res: ServerResponse): void {
  const path = url.pathname;

  if (path === '/health') {
    return json(res, 200, { status: 'ok' });
  }

  if (path === '/api-docs-json') {
    return json(res, 200, OPENAPI_SCHEMA);
  }

  if (path === '/api/search') {
    const number = q(url, 'number');
    const date   = q(url, 'date');
    if (!number)                        return bad(res, 'number is required');
    if (number.length > 10)             return bad(res, 'number must be 10 characters or fewer');
    if (date && !DATE_RE.test(date))    return bad(res, 'date must be YYYY-MM-DD');
    return json(res, 200, { legs: [] });
  }

  if (path === '/api/route') {
    const from = q(url, 'from');
    const to   = q(url, 'to');
    const date = q(url, 'date');
    if (!from)                    return bad(res, 'from is required');
    if (!to)                      return bad(res, 'to is required');
    if (!date)                    return bad(res, 'date is required');
    if (from.length < 3)          return bad(res, 'from must be a 3-character airport code');
    if (to.length < 3)            return bad(res, 'to must be a 3-character airport code');
    if (!DATE_RE.test(date))      return bad(res, 'date must be YYYY-MM-DD');
    return json(res, 200, {});
  }

  if (path === '/api/flight/history') {
    const number = q(url, 'number');
    if (!number) return bad(res, 'number is required');
    return json(res, 200, { flights: [] });
  }

  if (path === '/api/airline/profile') {
    const iata = q(url, 'iata');
    if (!iata)               return bad(res, 'iata is required');
    if (/^\d+$/.test(iata))  return bad(res, 'iata must contain letters, not only digits');
    return json(res, 200, {});
  }

  if (path === '/api/airline/rankings') {
    return json(res, 200, []);
  }

  if (path === '/api/airline/trend') {
    const iata = q(url, 'iata');
    if (!iata)               return bad(res, 'iata is required');
    if (/^\d+$/.test(iata))  return bad(res, 'iata must contain letters, not only digits');
    return json(res, 200, []);
  }

  json(res, 404, { error: 'Not Found', path });
}

export function startMockServer(port = 3199): Promise<{ url: string; stop: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'GET') {
        return json(res, 405, { error: 'Method Not Allowed' });
      }
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      route(url, res);
    });

    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const url = `http://localhost:${port}`;
      console.log(`[mock-server] Listening at ${url}`);
      resolve({
        url,
        stop: () => new Promise<void>((res, rej) => server.close(err => (err ? rej(err) : res()))),
      });
    });
  });
}

// Standalone CLI entry — runs when invoked directly via `npm run mock` or `tsx src/mock-server.ts`
const argv1 = process.argv[1] ?? '';
if (argv1.includes('mock-server')) {
  const port = parseInt(process.env.MOCK_PORT ?? '3199', 10);
  startMockServer(port)
    .then(({ url }) => {
      console.log(`[mock-server] Ready — press Ctrl+C to stop`);
      console.log(`  OpenAPI schema:  ${url}/api-docs-json`);
      console.log(`  Health check:    ${url}/health`);
      process.on('SIGINT',  () => process.exit(0));
      process.on('SIGTERM', () => process.exit(0));
    })
    .catch(err => {
      console.error('[mock-server] Failed to start:', err);
      process.exit(1);
    });
}
