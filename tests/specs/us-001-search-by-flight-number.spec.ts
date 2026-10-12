/**
 * US-001 — Search by flight number
 * Traces to: AC-01..AC-05, NEG-01, NEG-02, UI-01, UI-02, UI-03, ST-01, ST-02
 */

import { test, expect } from '../fixtures/test.fixture';
import { AppPage } from '../pages/AppPage';
import { FlightSearchPage } from '../pages/FlightSearchPage';
import { MOCK_SEARCH_RESULT, MOCK_FLIGHT_HISTORY, TEST_DATA } from '../data/mock-responses';

const API_BASE = 'http://localhost:3100';

test.describe('US-001 — Search by flight number', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(`${API_BASE}/api/search*`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SEARCH_RESULT) })
    );
    await page.route(`${API_BASE}/api/flight/history*`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FLIGHT_HISTORY) })
    );
  });

  // AC-01 — navigation
  test('TC-001-01: Find Flight tab is visible and navigable', async ({ app }) => {
    await app.navigateTo('flight');
    await app.expectActiveTab('flight');
  });

  // AC-02 — form structure
  test('TC-001-02: mode toggle and flight number input are visible', async ({ flightSearch }) => {
    await expect(flightSearch.page.getByRole('button', { name: /Flight number/i })).toBeVisible();
    await expect(flightSearch.page.getByRole('button', { name: /Route/i })).toBeVisible();
    await expect(flightSearch.flightNumberInput).toBeVisible();
  });

  // AC-03 — happy path
  test('TC-001-03: valid flight number returns a FlightCard with flight number and airline', async ({ flightSearch }) => {
    await flightSearch.searchByNumber(TEST_DATA.validFlightNumber, TEST_DATA.validDate);
    await flightSearch.waitForSearchComplete();

    await expect(flightSearch.page.getByText(TEST_DATA.validFlightNumber, { exact: true }).first()).toBeVisible();
    // Airline name renders as a clickable button on the FlightCard
    await expect(flightSearch.page.getByRole('button', { name: TEST_DATA.validAirlineName })).toBeVisible();
  });

  // AC-03 — airport codes
  test('TC-001-04: FlightCard shows origin and destination airport codes', async ({ flightSearch }) => {
    await flightSearch.searchByNumber(TEST_DATA.validFlightNumber, TEST_DATA.validDate);
    await flightSearch.waitForSearchComplete();

    await expect(flightSearch.page.getByText('BLR').first()).toBeVisible();
    await expect(flightSearch.page.getByText('DEL').first()).toBeVisible();
  });

  // AC-04 — status mapping
  test('TC-001-05: FlightCard shows "Landed" for a flight with status Arrived', async ({ flightSearch }) => {
    await flightSearch.searchByNumber(TEST_DATA.validFlightNumber, TEST_DATA.validDate);
    await flightSearch.waitForSearchComplete();

    await expect(flightSearch.page.getByText('Landed', { exact: true }).first()).toBeVisible();
  });

  // AC-05 — timing cells
  test('TC-001-06: FlightCard shows all six info cells: STD, ETD, STA, ETA, Delay, Status', async ({ flightSearch }) => {
    await flightSearch.searchByNumber(TEST_DATA.validFlightNumber, TEST_DATA.validDate);
    await flightSearch.waitForSearchComplete();

    for (const label of ['STD', 'ETD', 'STA', 'ETA', 'Delay', 'Status']) {
      await expect(flightSearch.page.getByText(label, { exact: true }).first()).toBeVisible();
    }
  });

  // NEG-01 — empty input guard
  test('TC-001-07: clicking Search with empty input does not trigger loading', async ({ flightSearch }) => {
    await flightSearch.searchButton.click();
    await expect(flightSearch.loadingText).toBeHidden();
  });

  // NEG-02 — API error
  test('TC-001-08: HTTP 500 from API shows error banner', async ({ page, app }) => {
    await page.route(`${API_BASE}/api/search*`, route =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Service unavailable' }) })
    );
    await app.navigateTo('flight');
    const flightSearch = new FlightSearchPage(page);
    await flightSearch.searchByNumber(TEST_DATA.validFlightNumber, TEST_DATA.validDate);
    await flightSearch.waitForSearchComplete();

    await expect(flightSearch.errorBanner).toBeVisible();
  });

  // UI-02 / UI-03 — mode toggle
  test('TC-001-10: switching to Route mode hides flight number input and shows From/To fields', async ({ flightSearch }) => {
    await flightSearch.selectRouteMode();
    await expect(flightSearch.flightNumberInput).toBeHidden();
    await expect(flightSearch.fromInput).toBeVisible();
    await expect(flightSearch.toInput).toBeVisible();
  });

  // ST-01 — hash routing
  test('TC-001-11: hash routing #flight/NUMBER opens tab and auto-searches', async ({ page }) => {
    await page.route(`${API_BASE}/api/search*`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SEARCH_RESULT) })
    );
    await page.route(`${API_BASE}/api/flight/history*`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FLIGHT_HISTORY) })
    );
    const app = new AppPage(page);
    await app.gotoViaHash(`flight/${encodeURIComponent(TEST_DATA.validFlightNumber)}`);
    await app.expectActiveTab('flight');

    const flightSearch = new FlightSearchPage(page);
    await flightSearch.waitForSearchComplete();
    await expect(page.getByText(TEST_DATA.validFlightNumber, { exact: true }).first()).toBeVisible();
  });

  // ST-02 — airline name click
  test('TC-001-12: clicking airline name on FlightCard navigates to #airline/{iata}', async ({ flightSearch }) => {
    await flightSearch.searchByNumber(TEST_DATA.validFlightNumber, TEST_DATA.validDate);
    await flightSearch.waitForSearchComplete();

    await flightSearch.page.getByRole('button', { name: TEST_DATA.validAirlineName }).click();
    await expect(flightSearch.page).toHaveURL(/#airline\/6E/);
  });
});
