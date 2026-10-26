/**
 * US-009 — Compare airlines on a route
 *
 * Runs against the real backend. Route analytics come from the flights the backend has
 * recorded, so the numbers change over time; each test captures the backend's response
 * for the same route and checks the UI shows exactly that, using the panel's own rules
 * (frontend/src/components/flight/RouteAnalytics.tsx).
 */

import { test, expect } from '../fixtures/test.fixture';
import { AppPage } from '../pages/AppPage';
import { FlightSearchPage } from '../pages/FlightSearchPage';
import { TEST_DATA } from '../data/test-data';
import { API_BASE, captureApi, todayLocal } from '../support/live';
import { fmt } from '../../frontend/src/lib/format';

const { routeFrom: FROM, routeTo: TO } = TEST_DATA;

// Formatting as RouteAnalytics.tsx renders it.
const pct = (v: number | null, decimals = 0) => (v == null ? '—' : `${(v * 100).toFixed(decimals)}%`);
const mins = (v: number | null) => (v == null ? '—' : `${v} min`);
const since = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** Search the route in Route mode and return the analytics response the panel received. */
async function openRoute(flightSearch: FlightSearchPage, from = FROM, to = TO) {
  const response = captureApi(flightSearch.page, '/api/route/analytics');
  await flightSearch.searchByRoute(from, to, todayLocal());
  const { status, body } = await response;
  expect(status, `route analytics ${from} → ${to}`).toBe(200);
  return body;
}

test.describe('US-009 — Compare airlines on a route', () => {
  test('TC-009-01: searching a route shows its analytics panel', async ({ flightSearch }) => {
    await openRoute(flightSearch);
    await expect(flightSearch.analytics.panel).toBeVisible();
    await expect(flightSearch.analytics.route).toHaveText(`${FROM} → ${TO}`);
  });

  test('TC-009-02: summary tiles show the backend figures, or the empty state', async ({ flightSearch }) => {
    const a = await openRoute(flightSearch);
    const panel = flightSearch.analytics;
    if (a.summary.flights === 0) {
      await expect(panel.empty).toBeVisible();
      await expect(panel.flights).toHaveCount(0);
      return;
    }
    await expect(panel.flights).toContainText(fmt(a.summary.flights));
    await expect(panel.avgDelay).toContainText(mins(a.summary.avgDelay));
    await expect(panel.onTime).toContainText(pct(a.summary.onTimePct));
    await expect(panel.cancellation).toContainText(pct(a.summary.cancellationRate, 1));
  });

  test('TC-009-03: the data period matches the earliest flight counted', async ({ flightSearch }) => {
    const a = await openRoute(flightSearch);
    test.skip(a.since == null, 'No flights recorded on this route yet');
    await expect(flightSearch.analytics.since).toHaveText(`Based on flights since ${since(a.since)}`);
  });

  test('TC-009-04: one row per scored airline, ranked by Reliability Score as the backend ranked them', async ({ flightSearch }) => {
    const a = await openRoute(flightSearch);
    test.skip(a.airlines.length === 0, `No airline has ${a.minFlights}+ completed flights on this route yet`);
    await expect(flightSearch.analytics.airlineRows).toHaveCount(a.airlines.length);
    expect(await flightSearch.analytics.rankedIatas()).toEqual(a.airlines.map((x: any) => x.iata));
  });

  test('TC-009-05: each airline row shows the backend values', async ({ flightSearch }) => {
    const a = await openRoute(flightSearch);
    test.skip(a.airlines.length === 0, `No airline has ${a.minFlights}+ completed flights on this route yet`);
    const cell = (iata: string, col: number) => flightSearch.analytics.airlineCell(iata, col);
    for (const x of a.airlines) {
      await expect(cell(x.iata, 0)).toContainText(x.name ?? x.iata);
      await expect(cell(x.iata, 1)).toHaveText(fmt(x.flights));
      await expect(cell(x.iata, 2)).toHaveText(pct(x.onTimePct));
      await expect(cell(x.iata, 3)).toHaveText(mins(x.avgDelay));
      await expect(cell(x.iata, 4)).toHaveText(pct(x.cancellationRate, 1));
      await expect(cell(x.iata, 5)).toHaveText(String(x.score));
    }
  });

  test('TC-009-06: airlines without enough completed flights are listed separately, without a score', async ({ flightSearch }) => {
    const a = await openRoute(flightSearch);
    const list = flightSearch.analytics.insufficient;
    if (a.insufficient.length === 0) {
      await expect(list).toHaveCount(0);
      return;
    }
    await expect(list).toContainText(`fewer than ${a.minFlights} completed flights`);
    for (const x of a.insufficient) {
      await expect(list).toContainText(`(${x.iata}) ${fmt(x.flights)} flight`);
      await expect(flightSearch.analytics.airlineRow(x.iata)).toHaveCount(0); // not in the ranked table
    }
  });

  test('TC-009-07: sorting by Avg delay puts the shortest delays first, then reverses', async ({ flightSearch }) => {
    const a = await openRoute(flightSearch);
    test.skip(a.airlines.length < 2, 'Fewer than 2 scored airlines on this route, so there is nothing to sort');
    // RouteAnalytics.tsx: the column decides the order; ties go to the higher score, then more
    // flights, in either direction. Unknown delays sort as "worst" (last when ascending).
    const byAvgDelay = (dir: 1 | -1) => (p: any, q: any) => {
      const pv = p.avgDelay ?? Infinity, qv = q.avgDelay ?? Infinity;
      const cmp = pv < qv ? -1 : pv > qv ? 1 : 0;
      return cmp !== 0 ? dir * cmp : (q.score - p.score) || (q.flights - p.flights);
    };
    const order = (dir: 1 | -1) => [...a.airlines].sort(byAvgDelay(dir)).map((x: any) => x.iata);
    const header = flightSearch.analytics.sortHeader('Avg delay');

    await header.click();
    await expect.poll(() => flightSearch.analytics.rankedIatas()).toEqual(order(1));
    await header.click();
    await expect.poll(() => flightSearch.analytics.rankedIatas()).toEqual(order(-1));
  });

  test('TC-009-08: clicking an airline opens its profile', async ({ flightSearch, page }) => {
    const a = await openRoute(flightSearch);
    test.skip(a.airlines.length === 0, `No airline has ${a.minFlights}+ completed flights on this route yet`);
    const iata = a.airlines[0].iata;
    await flightSearch.analytics.airlineRow(iata).click();
    await expect(page).toHaveURL(new RegExp(`#airline/${iata}$`));
    await new AppPage(page).expectActiveTab('airline');
  });

  test('TC-009-09: a route with no recorded flights shows the empty state', async ({ flightSearch }) => {
    // Valid code format, but no airport uses it, so the backend has nothing recorded.
    const a = await openRoute(flightSearch, FROM, 'ZZZ');
    expect(a.summary.flights).toBe(0);
    await expect(flightSearch.analytics.empty).toContainText('No data for this route yet');
  });

  test('TC-009-10: #route/BLR/DEL opens Find Flight in Route mode with the analytics', async ({ page }) => {
    const app = new AppPage(page);
    const response = captureApi(page, '/api/route/analytics');
    await app.gotoViaHash(`route/${FROM}/${TO}`);
    expect((await response).status).toBe(200);
    await app.expectActiveTab('flight');
    await expect(new FlightSearchPage(page).analytics.route).toHaveText(`${FROM} → ${TO}`);
  });
});

// The backend's own response, checked for internal consistency (no browser needed).
test.describe('US-009 — /api/route/analytics', () => {
  test('TC-009-11: totals, scores and ordering are consistent', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/route/analytics?from=${FROM}&to=${TO}`);
    expect(res.status()).toBe(200);
    const a = await res.json();
    expect(a).toMatchObject({ from: FROM, to: TO, minFlights: 5 });

    // Every flight belongs to the route total; rows without an airline code count only in the total.
    const perAirline = [...a.airlines, ...a.insufficient].reduce((s: number, x: any) => s + x.flights, 0);
    expect(perAirline).toBeLessThanOrEqual(a.summary.flights);

    for (const x of a.airlines) {
      expect(x.score, x.iata).toBeGreaterThanOrEqual(0);
      expect(x.score, x.iata).toBeLessThanOrEqual(100);
      expect(x.completed, `${x.iata} has a score, so it needs ${a.minFlights}+ completed flights`).toBeGreaterThanOrEqual(a.minFlights);
      expect(x.completed).toBeLessThanOrEqual(x.flights);
      for (const rate of [x.onTimePct, x.cancellationRate]) {
        if (rate == null) continue;
        expect(rate, x.iata).toBeGreaterThanOrEqual(0);
        expect(rate, x.iata).toBeLessThanOrEqual(1);
      }
    }
    for (const x of a.insufficient) expect(x.completed, x.iata).toBeLessThan(a.minFlights);
    const scores = a.airlines.map((x: any) => x.score);
    expect(scores, 'ranked best first').toEqual([...scores].sort((p, q) => q - p));
  });

  test('TC-009-12: IATA and ICAO codes give the same answer', async ({ request }) => {
    const get = async (from: string, to: string) => (await (await request.get(`${API_BASE}/api/route/analytics?from=${from}&to=${to}`)).json());
    const iata = await get(FROM, TO);
    const icao = await get('VOBL', 'VIDP'); // Bengaluru, Delhi
    // The backend learns which ICAO code goes with an IATA code from rows that carry both.
    test.skip(iata.summary.flights > 0 && icao.summary.flights === 0,
      'No recorded flight stores both codes for these airports yet, so VOBL/VIDP cannot be linked to BLR/DEL');
    expect(icao.summary).toEqual(iata.summary);
    expect(icao.airlines).toEqual(iata.airlines);
  });

  test('TC-009-13: invalid input is rejected with 400', async ({ request }) => {
    for (const q of [`from=${FROM}&to=${FROM}`, `from=X&to=${TO}`, `to=${TO}`]) {
      const res = await request.get(`${API_BASE}/api/route/analytics?${q}`);
      expect(res.status(), q).toBe(400);
    }
  });
});
