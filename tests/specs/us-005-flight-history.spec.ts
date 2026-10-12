/**
 * US-005 — Flight history
 */

import { test, expect } from '../fixtures/test.fixture';
import { AppPage } from '../pages/AppPage';
import { FlightSearchPage } from '../pages/FlightSearchPage';
import { MOCK_SEARCH_RESULT, MOCK_FLIGHT_HISTORY, TEST_DATA } from '../data/mock-responses';

const API_BASE = 'http://localhost:3100';

test.describe('US-005 — Flight history', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(`${API_BASE}/api/search*`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SEARCH_RESULT) })
    );
    await page.route(`${API_BASE}/api/flight/history*`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FLIGHT_HISTORY) })
    );
  });

  test('TC-005-01: flight history section appears below FlightCard', async ({ flightSearch }) => {
    await flightSearch.searchByNumber(TEST_DATA.validFlightNumber, TEST_DATA.validDate);
    await flightSearch.waitForSearchComplete();
    await expect(flightSearch.flightHistoryToggle).toBeVisible();
  });

  test('TC-005-02: section header reads "Flight history · last 7 days"', async ({ flightSearch }) => {
    await flightSearch.searchByNumber(TEST_DATA.validFlightNumber, TEST_DATA.validDate);
    await flightSearch.waitForSearchComplete();
    await expect(flightSearch.page.getByText(/Flight history · last 7 days/i)).toBeVisible();
  });

  test('TC-005-03: history table shows Date and Delay column headers', async ({ flightSearch }) => {
    await flightSearch.searchByNumber(TEST_DATA.validFlightNumber, TEST_DATA.validDate);
    await flightSearch.waitForSearchComplete();
    await expect(flightSearch.page.getByText('Date')).toBeVisible({ timeout: 10_000 });
    await expect(flightSearch.page.getByText('Delay').first()).toBeVisible();
  });

  test('TC-005-04: history table shows 7 rows', async ({ flightSearch }) => {
    await flightSearch.searchByNumber(TEST_DATA.validFlightNumber, TEST_DATA.validDate);
    await flightSearch.waitForSearchComplete();
    await expect(flightSearch.page.getByText('Date')).toBeVisible({ timeout: 10_000 });
    await expect(flightSearch.flightHistoryTable.locator('tbody tr')).toHaveCount(MOCK_FLIGHT_HISTORY.length);
  });

  test('TC-005-05: delayed row shows +N min label', async ({ flightSearch }) => {
    await flightSearch.searchByNumber(TEST_DATA.validFlightNumber, TEST_DATA.validDate);
    await flightSearch.waitForSearchComplete();
    await expect(flightSearch.page.getByText('Date')).toBeVisible({ timeout: 10_000 });
    await expect(flightSearch.page.getByText(/\+12/i)).toBeVisible();
  });

  test('TC-005-06: on-time row shows "On time"', async ({ flightSearch }) => {
    await flightSearch.searchByNumber(TEST_DATA.validFlightNumber, TEST_DATA.validDate);
    await flightSearch.waitForSearchComplete();
    await expect(flightSearch.page.getByText('Date')).toBeVisible({ timeout: 10_000 });
    await expect(flightSearch.page.getByText('On time')).toBeVisible();
  });

  test('TC-005-07: cancelled row shows "Cancelled"', async ({ flightSearch }) => {
    await flightSearch.searchByNumber(TEST_DATA.validFlightNumber, TEST_DATA.validDate);
    await flightSearch.waitForSearchComplete();
    await expect(flightSearch.page.getByText('Date')).toBeVisible({ timeout: 10_000 });
    await expect(flightSearch.page.getByText('Cancelled').first()).toBeVisible();
  });

  test('TC-005-08: clicking toggle collapses history section', async ({ flightSearch }) => {
    await flightSearch.searchByNumber(TEST_DATA.validFlightNumber, TEST_DATA.validDate);
    await flightSearch.waitForSearchComplete();
    await flightSearch.flightHistoryToggle.click();
    await expect(flightSearch.flightHistoryTable).toBeHidden();
  });

  test('TC-005-09: empty history shows no-data message', async ({ page, app }) => {
    await page.route(`${API_BASE}/api/flight/history*`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    );
    await app.navigateTo('flight');
    const flightSearch = new FlightSearchPage(page);
    await flightSearch.searchByNumber(TEST_DATA.validFlightNumber, TEST_DATA.validDate);
    await flightSearch.waitForSearchComplete();
    await expect(flightSearch.noHistoryMessage).toBeVisible({ timeout: 10_000 });
  });
});
