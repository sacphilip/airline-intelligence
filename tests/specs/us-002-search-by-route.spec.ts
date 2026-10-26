/**
 * US-002 — Search by route
 *
 * Runs against the real backend for today's flights on a busy route. Counts and
 * rows are checked against the backend's response for the same search, using
 * the filter rules from RouteTable in FlightSearchTab.tsx.
 */

import { test, expect } from '../fixtures/test.fixture';
import { FlightSearchPage } from '../pages/FlightSearchPage';
import { TEST_DATA } from '../data/test-data';
import { captureApi, todayLocal } from '../support/live';

const isDelayed = (f: any) => f.status === 'Delayed' || (f.delayMin ?? 0) >= 15;

async function searchRoute(flightSearch: FlightSearchPage) {
  const response = captureApi(flightSearch.page, '/api/route');
  await flightSearch.searchByRoute(TEST_DATA.routeFrom, TEST_DATA.routeTo, todayLocal());
  const { status, body } = await response;
  expect(status, `route ${TEST_DATA.routeFrom} → ${TEST_DATA.routeTo}`).toBe(200);
  await flightSearch.waitForSearchComplete();
  expect(body.flights.length, 'a busy route should have flights today').toBeGreaterThan(0);
  return body.flights as any[];
}

test.describe('US-002 — Search by route', () => {
  test('TC-002-01: route mode shows From, To, and date inputs', async ({ flightSearch }) => {
    await flightSearch.selectRouteMode();
    await expect(flightSearch.fromInput).toBeVisible();
    await expect(flightSearch.toInput).toBeVisible();
    await expect(flightSearch.dateInput).toBeVisible();
  });

  test('TC-002-02: route table has one row per flight the backend returned', async ({ flightSearch }) => {
    const flights = await searchRoute(flightSearch);
    await expect(flightSearch.routeTableRows).toHaveCount(flights.length);
  });

  test('TC-002-03: stats bar totals match the backend data', async ({ flightSearch }) => {
    const flights = await searchRoute(flightSearch);

    await expect(flightSearch.statsBar).toBeVisible();
    await expect(flightSearch.statValue('Total')).toHaveText(String(flights.length));
    await expect(flightSearch.statValue('Delayed')).toHaveText(String(flights.filter(isDelayed).length));
    await expect(flightSearch.statValue('Cancelled')).toHaveText(String(flights.filter((f) => f.status === 'Canceled' || f.status === 'CanceledUncertain').length));
  });

  test('TC-002-04: Delayed chip appears only when the backend reports delayed flights', async ({ flightSearch }) => {
    const flights = await searchRoute(flightSearch);
    const delayed = flights.filter(isDelayed).length;
    if (delayed > 0) await expect(flightSearch.statusChip('Delayed')).toHaveText(new RegExp(`^Delayed\\s*${delayed}$`));
    else await expect(flightSearch.statusChip('Delayed')).toHaveCount(0);
  });

  test('TC-002-05: clicking Delayed filter shows only the delayed flights', async ({ flightSearch }) => {
    const flights = await searchRoute(flightSearch);
    const delayed = flights.filter(isDelayed).length;
    test.skip(delayed === 0, 'No delayed flights on this route right now, so there is no Delayed filter to click');

    await flightSearch.statusChip('Delayed').click();
    await expect(flightSearch.routeTableRows).toHaveCount(delayed);
  });

  test('TC-002-06: clicking All filter restores all rows', async ({ flightSearch }) => {
    const flights = await searchRoute(flightSearch);
    // Narrow with any chip that has rows, then go back to All.
    if (await flightSearch.nonAllChip.count()) await flightSearch.nonAllChip.click();
    await flightSearch.statusChip('All').click();
    await expect(flightSearch.routeTableRows).toHaveCount(flights.length);
  });

  test('TC-002-07: invalid airport code shows validation error', async ({ flightSearch }) => {
    await flightSearch.selectRouteMode();
    await flightSearch.fromInput.fill(TEST_DATA.invalidAirportCode);
    await flightSearch.toInput.fill(TEST_DATA.routeTo);
    await flightSearch.searchButton.click();

    await expect(flightSearch.errorBanner).toBeVisible();
    await expect(flightSearch.airportCodeError).toBeVisible();
  });

  test('TC-002-08: route rows show the flight numbers and airline names from the backend', async ({ flightSearch }) => {
    const flights = await searchRoute(flightSearch);
    const first = flights.find((f) => f.number && f.airline?.name)!;
    const row = flightSearch.routeRow(first.number);
    await expect(row.first()).toBeVisible();
    await expect(row.first()).toContainText(first.airline.name);
  });
});
