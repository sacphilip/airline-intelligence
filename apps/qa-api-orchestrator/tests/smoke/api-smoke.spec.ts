/**
 * API Smoke Tests — SM-API-01 through SM-API-10
 *
 * Validates the backend without needing any flight data in the database.
 * Every test here works against a freshly started, empty Postgres instance.
 *
 * Covers:
 *   - Health / liveness check (backend is up)
 *   - 400 validation errors for all three main endpoints
 *   - 200 empty responses (schema intact when no data exists)
 *
 * These must pass for a PR merge status to be green.
 */
import { test, expect } from '@playwright/test';

// ── Health ────────────────────────────────────────────────────────────────────

test('SM-API-01: health endpoint returns 200', async ({ request }) => {
  const res = await request.get('/health');
  expect(res.status()).toBe(200);
});

test('SM-API-02: OpenAPI spec is reachable (backend fully initialised)', async ({ request }) => {
  const res = await request.get('/api-docs-json');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty('openapi');
});

// ── Flight search — validation ────────────────────────────────────────────────

test('SM-API-03: GET /api/search without query returns 400', async ({ request }) => {
  const res = await request.get('/api/search');
  expect(res.status()).toBe(400);
});

test('SM-API-04: GET /api/search with blank q returns 400', async ({ request }) => {
  const res = await request.get('/api/search?q=');
  expect(res.status()).toBe(400);
});

// ── Route analytics — validation ─────────────────────────────────────────────

test('SM-API-05: GET /api/route/analytics without params returns 400', async ({ request }) => {
  const res = await request.get('/api/route/analytics');
  expect(res.status()).toBe(400);
});

test('SM-API-06: GET /api/route/analytics with only "from" returns 400', async ({ request }) => {
  const res = await request.get('/api/route/analytics?from=BLR');
  expect(res.status()).toBe(400);
});

test('SM-API-07: GET /api/route/analytics with same from/to returns 400', async ({ request }) => {
  const res = await request.get('/api/route/analytics?from=BLR&to=BLR');
  expect(res.status()).toBe(400);
});

test('SM-API-08: GET /api/route/analytics with invalid IATA codes returns 400', async ({ request }) => {
  const res = await request.get('/api/route/analytics?from=INVALID&to=DEL');
  expect(res.status()).toBe(400);
});

// ── Airline profile — validation ──────────────────────────────────────────────

test('SM-API-09: GET /api/airline/profile without iata returns 400', async ({ request }) => {
  const res = await request.get('/api/airline/profile');
  expect(res.status()).toBe(400);
});

// ── Empty-state 200 (no data needed) ─────────────────────────────────────────

test('SM-API-10: GET /api/route/analytics with valid params returns 200 even with no data', async ({ request }) => {
  const res = await request.get('/api/route/analytics?from=BLR&to=DEL');
  expect(res.status()).toBe(200);
  const body = await res.json();
  // Shape must be present even when there are no flights
  expect(body).toHaveProperty('from', 'BLR');
  expect(body).toHaveProperty('to', 'DEL');
  expect(body).toHaveProperty('airlines');
  expect(Array.isArray(body.airlines)).toBe(true);
});

test('SM-API-11: GET /api/airline/profile returns 200 for an unknown airline', async ({ request }) => {
  const res = await request.get('/api/airline/profile?iata=ZZ');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty('iata', 'ZZ');
  expect(body).toHaveProperty('observed');
});
