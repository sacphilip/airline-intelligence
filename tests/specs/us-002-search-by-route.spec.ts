/**
 * US-002 — Search by route
 */

import { test, expect } from '../fixtures/test.fixture';
import { MOCK_ROUTE_RESULT, TEST_DATA } from '../data/mock-responses';

const API_BASE = 'http://localhost:3100';

test.describe('US-002 — Search by route', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(`${API_BASE}/api/route*`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_ROUTE_RESULT) })
    );
  });

  test('TC-002-01: route mode shows From, To, and date inputs', async ({ flightSearch }) => {
    await flightSearch.selectRouteMode();
    await expect(flightSearch.fromInput).toBeVisible();
    await expect(flightSearch.toInput).toBeVisible();
    await expect(flightSearch.page.locator('input[type="date"]')).toBeVisible();
  });

  test('TC-002-02: valid route returns RouteTable with 3 rows', async ({ flightSearch }) => {
    await flightSearch.searchByRoute(TEST_DATA.validRouteFrom, TEST_DATA.validRouteTo, TEST_DATA.validDate);
    await flightSearch.waitForSearchComplete();

    await expect(flightSearch.routeTableRows).toHaveCount(3);
  });

  test('TC-002-03: stats bar is visible after route search', async ({ flightSearch }) => {
    await flightSearch.searchByRoute(TEST_DATA.validRouteFrom, TEST_DATA.validRouteTo, TEST_DATA.validDate);
    await flightSearch.waitForSearchComplete();

    await expect(flightSearch.statsBar).toBeVisible();
  });

  test('TC-002-04: Delayed filter chip is visible (mock has 1 delayed)', async ({ flightSearch }) => {
    await flightSearch.searchByRoute(TEST_DATA.validRouteFrom, TEST_DATA.validRouteTo, TEST_DATA.validDate);
    await flightSearch.waitForSearchComplete();

    await expect(flightSearch.page.getByRole('button', { name: /Delayed/i })).toBeVisible();
  });

  test('TC-002-05: clicking Delayed filter shows only 1 row', async ({ flightSearch }) => {
    await flightSearch.searchByRoute(TEST_DATA.validRouteFrom, TEST_DATA.validRouteTo, TEST_DATA.validDate);
    await flightSearch.waitForSearchComplete();

    await flightSearch.page.getByRole('button', { name: /Delayed/i }).first().click();
    await expect(flightSearch.routeTableRows).toHaveCount(1);
  });

  test('TC-002-06: clicking All filter restores all rows', async ({ flightSearch }) => {
    await flightSearch.searchByRoute(TEST_DATA.validRouteFrom, TEST_DATA.validRouteTo, TEST_DATA.validDate);
    await flightSearch.waitForSearchComplete();

    await flightSearch.page.getByRole('button', { name: /Delayed/i }).first().click();
    await flightSearch.page.getByRole('button', { name: /^All/i }).first().click();
    await expect(flightSearch.routeTableRows).toHaveCount(3);
  });

  test('TC-002-07: invalid airport code shows validation error', async ({ flightSearch }) => {
    await flightSearch.selectRouteMode();
    await flightSearch.fromInput.fill(TEST_DATA.invalidAirportCode);
    await flightSearch.toInput.fill(TEST_DATA.validRouteTo);
    await flightSearch.searchButton.click();

    await expect(flightSearch.errorBanner).toBeVisible();
    await expect(flightSearch.page.getByText(/3–4 letter/i)).toBeVisible();
  });

  test('TC-002-08: route rows show flight numbers and airline names', async ({ flightSearch }) => {
    await flightSearch.searchByRoute(TEST_DATA.validRouteFrom, TEST_DATA.validRouteTo, TEST_DATA.validDate);
    await flightSearch.waitForSearchComplete();

    await expect(flightSearch.page.getByText('6E 2101')).toBeVisible();
    await expect(flightSearch.page.locator('table').getByText('IndiGo').first()).toBeVisible();
  });
});
