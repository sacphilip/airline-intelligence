/**
 * US-003 — Flight card
 */

import { test, expect } from '../fixtures/test.fixture';
import { AppPage } from '../pages/AppPage';
import { FlightSearchPage } from '../pages/FlightSearchPage';
import { MOCK_SEARCH_RESULT, MOCK_FLIGHT_HISTORY, TEST_DATA } from '../data/mock-responses';

const API_BASE = 'http://localhost:3100';

test.describe('US-003 — Flight card', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(`${API_BASE}/api/search*`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SEARCH_RESULT) })
    );
    await page.route(`${API_BASE}/api/flight/history*`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FLIGHT_HISTORY) })
    );
  });

  test('TC-003-01: FlightCard shows flight number', async ({ flightSearch }) => {
    await flightSearch.searchByNumber(TEST_DATA.validFlightNumber, TEST_DATA.validDate);
    await flightSearch.waitForSearchComplete();
    await expect(flightSearch.page.getByText(TEST_DATA.validFlightNumber, { exact: true }).first()).toBeVisible();
  });

  test('TC-003-02: FlightCard shows STD label', async ({ flightSearch }) => {
    await flightSearch.searchByNumber(TEST_DATA.validFlightNumber, TEST_DATA.validDate);
    await flightSearch.waitForSearchComplete();
    await expect(flightSearch.page.getByText('STD', { exact: true })).toBeVisible();
  });

  test('TC-003-03: FlightCard shows ETD label', async ({ flightSearch }) => {
    await flightSearch.searchByNumber(TEST_DATA.validFlightNumber, TEST_DATA.validDate);
    await flightSearch.waitForSearchComplete();
    await expect(flightSearch.page.getByText('ETD', { exact: true })).toBeVisible();
  });

  test('TC-003-04: FlightCard shows STA label', async ({ flightSearch }) => {
    await flightSearch.searchByNumber(TEST_DATA.validFlightNumber, TEST_DATA.validDate);
    await flightSearch.waitForSearchComplete();
    await expect(flightSearch.page.getByText('STA', { exact: true })).toBeVisible();
  });

  test('TC-003-05: FlightCard shows ETA label', async ({ flightSearch }) => {
    await flightSearch.searchByNumber(TEST_DATA.validFlightNumber, TEST_DATA.validDate);
    await flightSearch.waitForSearchComplete();
    await expect(flightSearch.page.getByText('ETA', { exact: true })).toBeVisible();
  });

  test('TC-003-06: FlightCard shows Delay label', async ({ flightSearch }) => {
    await flightSearch.searchByNumber(TEST_DATA.validFlightNumber, TEST_DATA.validDate);
    await flightSearch.waitForSearchComplete();
    await expect(flightSearch.page.getByText('Delay', { exact: true }).first()).toBeVisible();
  });

  test('TC-003-07: FlightCard shows Status label', async ({ flightSearch }) => {
    await flightSearch.searchByNumber(TEST_DATA.validFlightNumber, TEST_DATA.validDate);
    await flightSearch.waitForSearchComplete();
    await expect(flightSearch.page.getByText('Status', { exact: true }).first()).toBeVisible();
  });

  test('TC-003-08: Arrived status maps to "Landed" badge', async ({ flightSearch }) => {
    await flightSearch.searchByNumber(TEST_DATA.validFlightNumber, TEST_DATA.validDate);
    await flightSearch.waitForSearchComplete();
    await expect(flightSearch.page.getByText('Landed', { exact: true }).first()).toBeVisible();
  });

  test('TC-003-09: FlightCard shows origin and destination airport codes', async ({ flightSearch }) => {
    await flightSearch.searchByNumber(TEST_DATA.validFlightNumber, TEST_DATA.validDate);
    await flightSearch.waitForSearchComplete();
    await expect(flightSearch.page.getByText('BLR').first()).toBeVisible();
    await expect(flightSearch.page.getByText('DEL').first()).toBeVisible();
  });

  test('TC-003-10: clicking airline name navigates to #airline/{iata}', async ({ page, app }) => {
    await page.route(`${API_BASE}/api/search*`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SEARCH_RESULT) })
    );
    await page.route(`${API_BASE}/api/flight/history*`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FLIGHT_HISTORY) })
    );
    await app.navigateTo('flight');
    const flightSearch = new FlightSearchPage(page);
    await flightSearch.searchByNumber(TEST_DATA.validFlightNumber, TEST_DATA.validDate);
    await flightSearch.waitForSearchComplete();
    await page.getByRole('button', { name: TEST_DATA.validAirlineName }).click();
    await expect(page).toHaveURL(/#airline\/6E/);
    await app.expectActiveTab('airline');
  });
});
