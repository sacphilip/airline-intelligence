/**
 * US-001 — Search by flight number
 * Traces to: AC-01..AC-05, NEG-01, NEG-02, UI-01, UI-02, UI-03, ST-01, ST-02
 *
 * Runs against the real backend and live flight data. A real flight operating
 * today is picked first; each test then checks the UI against the exact
 * response the backend returned for that search.
 */

import { test, expect } from '../fixtures/test.fixture';
import { AppPage } from '../pages/AppPage';
import { FlightSearchPage } from '../pages/FlightSearchPage';
import { TEST_DATA } from '../data/test-data';
import { captureApi, pickLiveFlight } from '../support/live';
import { flightStatus } from '../../frontend/src/lib/flight-status';
import { airportCode } from '../../frontend/src/lib/format';

let flightNumber: string;

test.beforeAll(async ({ playwright }) => {
  const request = await playwright.request.newContext();
  ({ number: flightNumber } = await pickLiveFlight(request, TEST_DATA.routeFrom, TEST_DATA.routeTo));
  await request.dispose();
});

/** Search in the UI and return the leg the backend sent for the first card. */
async function search(flightSearch: FlightSearchPage) {
  const response = captureApi(flightSearch.page, '/api/search');
  await flightSearch.searchByNumber(flightNumber);
  const { status, body } = await response;
  expect(status, `search ${flightNumber}`).toBe(200);
  await flightSearch.waitForSearchComplete();
  return body.legs[0];
}

test.describe('US-001 — Search by flight number', () => {
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
  test('TC-001-03: a real flight number returns a FlightCard with its number and airline', async ({ flightSearch }) => {
    const leg = await search(flightSearch);
    await expect(flightSearch.page.getByText(leg.number, { exact: true }).first()).toBeVisible();
    await expect(flightSearch.page.getByRole('button', { name: leg.airline.name })).toBeVisible();
  });

  // AC-03 — airport codes
  test('TC-001-04: FlightCard shows the origin and destination the backend returned', async ({ flightSearch }) => {
    const leg = await search(flightSearch);
    await expect(flightSearch.page.getByText(airportCode(leg.origin.airport), { exact: true }).first()).toBeVisible();
    await expect(flightSearch.page.getByText(airportCode(leg.destination.airport), { exact: true }).first()).toBeVisible();
  });

  // AC-04 — status mapping
  test('TC-001-05: FlightCard status matches the live status from the backend', async ({ flightSearch }) => {
    const leg = await search(flightSearch);
    const expected = flightStatus(leg);
    await expect(flightSearch.statusPill).toContainText(expected.text);
  });

  // AC-05 — timing cells
  test('TC-001-06: FlightCard shows all six info cells: STD, ETD, STA, ETA, Delay, Status', async ({ flightSearch }) => {
    await search(flightSearch);
    for (const label of ['STD', 'ETD', 'STA', 'ETA', 'Delay', 'Status']) {
      await expect(flightSearch.page.getByText(label, { exact: true }).first()).toBeVisible();
    }
  });

  // NEG-01 — empty input guard
  test('TC-001-07: clicking Search with empty input does not trigger loading', async ({ flightSearch }) => {
    await flightSearch.searchButton.click();
    await expect(flightSearch.loadingText).toBeHidden();
  });

  // NEG-02 — the backend's real error for a flight that doesn't exist
  test('TC-001-08: an unknown flight number shows the backend error in a banner', async ({ flightSearch }) => {
    const response = captureApi(flightSearch.page, '/api/search');
    await flightSearch.searchByNumber(TEST_DATA.unknownFlightNumber);
    const { status } = await response;
    expect(status).toBe(404);
    await flightSearch.waitForSearchComplete();

    await expect(flightSearch.errorBanner).toBeVisible();
    await expect(flightSearch.errorBanner).toContainText(TEST_DATA.unknownFlightNumber);
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
    const response = captureApi(page, '/api/search');
    const app = new AppPage(page);
    await app.gotoViaHash(`flight/${encodeURIComponent(flightNumber)}`);
    await app.expectActiveTab('flight');

    const { status, body } = await response;
    expect(status).toBe(200);
    await new FlightSearchPage(page).waitForSearchComplete();
    await expect(page.getByText(body.legs[0].number, { exact: true }).first()).toBeVisible();
  });

  // ST-02 — airline name click
  test('TC-001-12: clicking airline name on FlightCard navigates to #airline/{iata}', async ({ flightSearch }) => {
    const leg = await search(flightSearch);
    await flightSearch.page.getByRole('button', { name: leg.airline.name }).click();
    await expect(flightSearch.page).toHaveURL(new RegExp(`#airline/${leg.airline.iata}$`));
  });
});
