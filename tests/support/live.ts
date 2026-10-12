/**
 * Helpers for testing against the real backend (no mocks).
 *
 * Live data changes from minute to minute, so tests never assert fixed values.
 * Instead each test lets the page make its real API call, captures the exact
 * response the backend sent, and checks the UI rendered that response.
 */

import { APIRequestContext, Page, Response, expect } from '@playwright/test';

export const API_BASE = process.env.API_BASE_URL ?? 'http://localhost:3100';

// Same rule as frontend/src/lib/format.ts todayLocal(): the browser and this
// process run on the same machine, so they agree on "today".
export function todayLocal(): string {
  return new Date().toLocaleDateString('en-CA');
}

export type Captured<T = any> = { status: number; body: T };

/**
 * Start waiting for the backend response to `path` *before* triggering the UI
 * action, so a fast response can't be missed. Await the returned promise after
 * the action.
 */
export function captureApi<T = any>(page: Page, path: string, timeout = 45_000): Promise<Captured<T>> {
  // Match the exact path: a prefix match would also catch e.g. /api/route/analytics for /api/route.
  const target = new URL(path, API_BASE);
  const matches = (r: Response) => {
    const u = new URL(r.url());
    return u.origin === target.origin && u.pathname === target.pathname && r.request().method() === 'GET';
  };
  return page
    .waitForResponse(matches, { timeout })
    .then(async (r) => ({ status: r.status(), body: await r.json().catch(() => ({})) }));
}

async function getJson<T>(request: APIRequestContext, path: string): Promise<T> {
  const res = await request.get(`${API_BASE}${path}`, { timeout: 60_000 });
  expect(res.ok(), `GET ${path} → ${res.status()} ${await res.text().catch(() => '')}`).toBeTruthy();
  return res.json() as Promise<T>;
}

/** Today's real flights on a route (the backend caches this for 30 min, so repeat calls are free). */
export function liveRoute(request: APIRequestContext, from: string, to: string, date = todayLocal()) {
  return getJson<{ flights: any[] }>(request, `/api/route?from=${from}&to=${to}&date=${date}`);
}

/**
 * A real flight number operating today on the route, for tests that need one.
 * Prefers an airline flight that isn't cancelled, so the search has a full card.
 */
export async function pickLiveFlight(request: APIRequestContext, from: string, to: string) {
  const { flights } = await liveRoute(request, from, to);
  const flight = flights.find((f) => f.number && f.airline?.iata && !f.cancelled) ?? flights.find((f) => f.number);
  if (!flight) throw new Error(`No real flights found ${from} → ${to} today; pick a busier route in tests/data/test-data.ts`);
  return { number: flight.number as string, airline: flight.airline as { name: string; iata: string } };
}
