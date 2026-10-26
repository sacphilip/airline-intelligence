import { createServer, IncomingMessage, ServerResponse } from 'http';

// Static OpenAPI schema returned by GET /api-docs-json.
// Phase 2 of the orchestrator reads this to discover endpoints and parameters.
const OPENAPI_SCHEMA = {
  openapi: '3.0.0',
  info: { title: 'Flight Tracker API (Mock)', version: '1.0.0' },
  paths: {
    '/api/auth/oauth/providers': {
      get: {
        summary: 'List configured OAuth providers',
        responses: {
          '200': { description: 'List of enabled providers', content: { 'application/json': { schema: { type: 'object', properties: { providers: { type: 'array', items: { type: 'string' } } } } } } },
        },
      },
    },
    '/api/auth/oauth/{provider}/start': {
      get: {
        summary: 'Begin OAuth sign-in — redirects to provider consent screen',
        parameters: [
          { name: 'provider', in: 'path', required: true, schema: { type: 'string', enum: ['google', 'github'] } },
          { name: 'next',     in: 'query', required: false, schema: { type: 'string' }, description: 'Path to redirect to after login' },
        ],
        responses: {
          '302': { description: 'Redirect to provider' },
          '404': { description: 'Provider not configured' },
        },
      },
    },
    '/api/auth/oauth/{provider}/callback': {
      get: {
        summary: 'OAuth callback — validates state and code, then logs in or creates account',
        parameters: [
          { name: 'provider', in: 'path',  required: true,  schema: { type: 'string' } },
          { name: 'code',     in: 'query', required: false, schema: { type: 'string' } },
          { name: 'state',    in: 'query', required: false, schema: { type: 'string' } },
          { name: 'error',    in: 'query', required: false, schema: { type: 'string' }, description: 'Provider error (e.g. access_denied)' },
        ],
        responses: {
          '302': { description: 'Redirect to app (success or login page with error)' },
        },
      },
    },
    '/api/auth/oauth/{provider}/link': {
      post: {
        summary: 'Link a provider to the authenticated user',
        parameters: [
          { name: 'provider', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { code: { type: 'string' }, state: { type: 'string' } }, required: ['code', 'state'] } } },
        },
        responses: {
          '200': { description: 'Provider linked' },
          '401': { description: 'Not authenticated' },
          '409': { description: 'Provider already linked to another user' },
        },
      },
      delete: {
        summary: 'Unlink a provider from the authenticated user',
        parameters: [
          { name: 'provider', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Provider unlinked' },
          '400': { description: 'Cannot remove last authentication method' },
          '401': { description: 'Not authenticated' },
        },
      },
    },
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

const CONFIGURED_PROVIDERS = new Set(['google', 'github']);
const MOCK_VALID_STATE = 'mock_valid_state_abc123';

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { Location: location });
  res.end();
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
  });
}

function hasMockSession(req: IncomingMessage): boolean {
  const cookie = req.headers['cookie'] ?? '';
  return cookie.includes('session=');
}

function route(url: URL, res: ServerResponse, req: IncomingMessage): void {
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (path === '/health') {
    return json(res, 200, { status: 'ok' });
  }

  if (path === '/api-docs-json') {
    return json(res, 200, OPENAPI_SCHEMA);
  }

  /* ── OAuth endpoints ── */

  if (path === '/api/auth/oauth/providers' && method === 'GET') {
    return json(res, 200, { providers: ['google', 'github'] });
  }

  const startMatch = path.match(/^\/api\/auth\/oauth\/([^/]+)\/start$/);
  if (startMatch && method === 'GET') {
    const provider = startMatch[1];
    if (!CONFIGURED_PROVIDERS.has(provider)) return json(res, 404, { error: 'Provider not configured' });
    const next  = url.searchParams.get('next') ?? '/';
    const state = MOCK_VALID_STATE;
    const mockConsentUrl = `https://mock-oauth.example.com/${provider}/auth?state=${state}&next=${encodeURIComponent(next)}`;
    return redirect(res, mockConsentUrl);
  }

  const callbackMatch = path.match(/^\/api\/auth\/oauth\/([^/]+)\/callback$/);
  if (callbackMatch && method === 'GET') {
    const provider = callbackMatch[1];
    if (!CONFIGURED_PROVIDERS.has(provider)) return json(res, 404, { error: 'Provider not configured' });

    const error = url.searchParams.get('error');
    if (error) return redirect(res, `/login?error=cancelled`);

    const code  = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state) return redirect(res, `/login?error=cancelled`);
    if (state !== MOCK_VALID_STATE) return redirect(res, `/login?error=state_mismatch`);

    // Sentinel codes for specific scenarios
    if (code === 'no_verified_email') return redirect(res, `/login?error=no_verified_email`);
    if (code === 'email_conflict')    return redirect(res, `/login?error=email_exists`);
    if (code === 'already_linked')    return redirect(res, `/login?error=already_linked`);

    return redirect(res, '/');
  }

  const linkMatch = path.match(/^\/api\/auth\/oauth\/([^/]+)\/link$/);
  if (linkMatch && method === 'POST') {
    if (!hasMockSession(req)) return json(res, 401, { error: 'Unauthorized' });
    const provider = linkMatch[1];
    if (!CONFIGURED_PROVIDERS.has(provider)) return json(res, 404, { error: 'Provider not configured' });
    readBody(req).then(raw => {
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(raw); } catch { /* ignore */ }
      if (!body.code || !body.state) return bad(res, 'code and state are required');
      if (body.code === 'already_linked') return json(res, 409, { error: 'This provider account is already linked to another user.' });
      return json(res, 200, { linked: provider });
    });
    return;
  }

  if (linkMatch && method === 'DELETE') {
    if (!hasMockSession(req)) return json(res, 401, { error: 'Unauthorized' });
    const provider = linkMatch[1];
    if (!CONFIGURED_PROVIDERS.has(provider)) return json(res, 404, { error: 'Provider not configured' });
    const onlyMethod = url.searchParams.get('only') === '1';
    if (onlyMethod) return json(res, 400, { error: 'Cannot remove your only authentication method.' });
    return json(res, 200, { unlinked: provider });
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

  if (method !== 'GET') {
    return json(res, 405, { error: 'Method Not Allowed' });
  }

  json(res, 404, { error: 'Not Found', path });
}

export function startMockServer(port = 3199): Promise<{ url: string; stop: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      route(url, res, req);
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
