/**
 * US-006 — Airline profile
 */

import { test, expect } from '../fixtures/test.fixture';
import { AppPage } from '../pages/AppPage';
import { AirlinePage } from '../pages/AirlinePage';
import { FlightSearchPage } from '../pages/FlightSearchPage';
import { MOCK_AIRLINE_PROFILE, MOCK_SEARCH_RESULT, MOCK_FLIGHT_HISTORY, TEST_DATA } from '../data/mock-responses';

const API_BASE = 'http://localhost:3100';

test.describe('US-006 — Airline profile', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(`${API_BASE}/api/airline/profile*`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_AIRLINE_PROFILE) })
    );
  });

  test('TC-006-01: Airlines tab shows IATA search form', async ({ airlinePage }) => {
    await expect(airlinePage.iataInput).toBeVisible();
    await expect(airlinePage.searchButton).toBeVisible();
  });

  test('TC-006-02: empty IATA search does not trigger loading', async ({ airlinePage }) => {
    await airlinePage.searchButton.click();
    await expect(airlinePage.loadingText).toBeHidden();
  });

  test('TC-006-03: valid IATA lookup shows airline name', async ({ airlinePage }) => {
    await airlinePage.lookup(TEST_DATA.validAirlineIata);
    await airlinePage.waitForProfile();
    await expect(airlinePage.page.locator('div.text-xl').filter({ hasText: TEST_DATA.validAirlineName })).toBeVisible();
  });

  test('TC-006-04: profile shows Reliability Score number and /100', async ({ airlinePage }) => {
    await airlinePage.lookup(TEST_DATA.validAirlineIata);
    await airlinePage.waitForProfile();
    await expect(airlinePage.page.getByText(`${MOCK_AIRLINE_PROFILE.score}`, { exact: true })).toBeVisible();
    await expect(airlinePage.page.getByText('/100')).toBeVisible();
  });

  test('TC-006-05: profile shows on-time percentage', async ({ airlinePage }) => {
    await airlinePage.lookup(TEST_DATA.validAirlineIata);
    await airlinePage.waitForProfile();
    await expect(airlinePage.page.getByText(/84\.0%/)).toBeVisible();
  });

  test('TC-006-06: profile shows average delay value', async ({ airlinePage }) => {
    await airlinePage.lookup(TEST_DATA.validAirlineIata);
    await airlinePage.waitForProfile();
    await expect(airlinePage.page.getByText(/18 min/)).toBeVisible();
  });

  test('TC-006-07: Reliability breakdown section is visible', async ({ airlinePage }) => {
    await airlinePage.lookup(TEST_DATA.validAirlineIata);
    await airlinePage.waitForProfile();
    await expect(airlinePage.page.getByRole('heading', { name: 'Reliability score breakdown' })).toBeVisible();
  });

  test('TC-006-08: Delay analysis section is visible', async ({ airlinePage }) => {
    await airlinePage.lookup(TEST_DATA.validAirlineIata);
    await airlinePage.waitForProfile();
    await expect(airlinePage.page.getByText('Delay analysis')).toBeVisible();
  });

  test('TC-006-09: Routes section is visible', async ({ airlinePage }) => {
    await airlinePage.lookup(TEST_DATA.validAirlineIata);
    await airlinePage.waitForProfile();
    await expect(airlinePage.page.getByRole('heading', { name: 'Routes' })).toBeVisible();
  });

  test('TC-006-10: Airports section is visible', async ({ airlinePage }) => {
    await airlinePage.lookup(TEST_DATA.validAirlineIata);
    await airlinePage.waitForProfile();
    await expect(airlinePage.page.getByText('Airports')).toBeVisible();
  });

  test('TC-006-11: Fleet section is visible', async ({ airlinePage }) => {
    await airlinePage.lookup(TEST_DATA.validAirlineIata);
    await airlinePage.waitForProfile();
    await expect(airlinePage.page.getByRole('heading', { name: /Fleet/ })).toBeVisible();
  });

  test('TC-006-12: fleet section shows registration numbers', async ({ airlinePage }) => {
    await airlinePage.lookup(TEST_DATA.validAirlineIata);
    await airlinePage.waitForProfile();
    for (const reg of MOCK_AIRLINE_PROFILE.regs) {
      await expect(airlinePage.page.getByText(reg)).toBeVisible();
    }
  });

  test('TC-006-13: hash routing #airline/6E navigates to tab and auto-looks up', async ({ page }) => {
    const app = new AppPage(page);
    await app.gotoViaHash(`airline/${TEST_DATA.validAirlineIata}`);
    await app.expectActiveTab('airline');
    const airlinePage = new AirlinePage(page);
    await airlinePage.waitForProfile();
    await expect(page.locator('div.text-xl').filter({ hasText: TEST_DATA.validAirlineName })).toBeVisible();
  });

  test('TC-006-14: API error shows error banner', async ({ page, app }) => {
    await page.route(`${API_BASE}/api/airline/profile*`, route =>
      route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Airline not found' }) })
    );
    await app.navigateTo('airline');
    const airlinePage = new AirlinePage(page);
    await airlinePage.lookup('ZZ');
    await expect(airlinePage.loadingText).toBeHidden({ timeout: 10_000 });
    await expect(airlinePage.errorBanner).toBeVisible();
  });

  test('TC-006-15: airline name click in FlightCard navigates to Airlines tab', async ({ page }) => {
    await page.route(`${API_BASE}/api/search*`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SEARCH_RESULT) })
    );
    await page.route(`${API_BASE}/api/flight/history*`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FLIGHT_HISTORY) })
    );
    const app = new AppPage(page);
    await app.goto();
    await app.navigateTo('flight');
    const flightSearch = new FlightSearchPage(page);
    await flightSearch.searchByNumber(TEST_DATA.validFlightNumber, TEST_DATA.validDate);
    await flightSearch.waitForSearchComplete();
    await page.getByRole('button', { name: TEST_DATA.validAirlineName }).click();
    await expect(page).toHaveURL(/#airline\/6E/);
  });
});
