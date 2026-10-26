/**
 * US-006 — Airline profile
 *
 * Runs against the real backend. The profile is built from the flights the
 * backend has recorded, so it changes over time; each test checks the UI
 * against the backend's response for the same lookup.
 */

import { test, expect } from '../fixtures/test.fixture';
import { AppPage } from '../pages/AppPage';
import { AirlinePage } from '../pages/AirlinePage';
import { FlightSearchPage } from '../pages/FlightSearchPage';
import { TEST_DATA } from '../data/test-data';
import { captureApi, pickLiveFlight } from '../support/live';

// A real airline flying the test route today, and one of its flight numbers.
let airline: { name: string; iata: string };
let flightNumber: string;

test.beforeAll(async ({ playwright }) => {
  const request = await playwright.request.newContext();
  ({ number: flightNumber, airline } = await pickLiveFlight(request, TEST_DATA.routeFrom, TEST_DATA.routeTo));
  await request.dispose();
});

async function lookup(airlinePage: AirlinePage, iata = airline.iata) {
  const response = captureApi(airlinePage.page, '/api/airline/profile');
  await airlinePage.lookup(iata);
  const { status, body } = await response;
  expect(status, `profile ${iata}`).toBe(200);
  await airlinePage.waitForProfile();
  return body;
}

// The same formatting AirlineTab uses for its key metrics.
const fmtPct = (r: number | null) => (r == null ? '—' : `${(r * 100).toFixed(1)}%`);
const fmtMin = (n: number | null) => (n == null ? '—' : `${n} min`);

test.describe('US-006 — Airline profile', () => {
  test('TC-006-01: Airlines tab shows IATA search form', async ({ airlinePage }) => {
    await expect(airlinePage.iataInput).toBeVisible();
    await expect(airlinePage.searchButton).toBeVisible();
  });

  test('TC-006-02: empty IATA search does not trigger loading', async ({ airlinePage }) => {
    await airlinePage.searchButton.click();
    await expect(airlinePage.loadingText).toBeHidden();
  });

  test('TC-006-03: lookup shows the airline name the backend returned', async ({ airlinePage }) => {
    const p = await lookup(airlinePage);
    await expect(airlinePage.airlineName(p.airline?.name ?? p.iata)).toBeVisible();
  });

  test('TC-006-04: profile shows the reliability score, or "Not enough data"', async ({ airlinePage }) => {
    const p = await lookup(airlinePage);
    if (p.score != null) {
      await expect(airlinePage.scoreValue(p.score)).toBeVisible();
      await expect(airlinePage.scoreOutOf).toBeVisible();
    } else {
      await expect(airlinePage.notEnoughData).toBeVisible();
    }
  });

  test('TC-006-05: profile shows the on-time percentage from the backend', async ({ airlinePage }) => {
    const p = await lookup(airlinePage);
    await expect(airlinePage.overviewSection).toContainText(fmtPct(p.onTimePct));
  });

  test('TC-006-06: profile shows the average delay from the backend', async ({ airlinePage }) => {
    const p = await lookup(airlinePage);
    await expect(airlinePage.overviewSection).toContainText(fmtMin(p.avgDelay));
  });

  test('TC-006-07: score breakdown appears exactly when the backend has a score', async ({ airlinePage }) => {
    const p = await lookup(airlinePage);
    const heading = airlinePage.scoreBreakdownHeading;
    if (p.score != null) await expect(heading).toBeVisible();
    else await expect(heading).toHaveCount(0);
  });

  test('TC-006-08: Delay analysis appears exactly when flights have been observed', async ({ airlinePage }) => {
    const p = await lookup(airlinePage);
    const heading = airlinePage.delayAnalysis;
    if (p.observed > 0) await expect(heading).toBeVisible();
    else await expect(heading).toHaveCount(0);
  });

  test('TC-006-09: Routes section lists the backend\'s top routes', async ({ airlinePage }) => {
    const p = await lookup(airlinePage);
    test.skip(!p.topRoutes?.length, `No recorded routes for ${airline.iata} yet`);
    await expect(airlinePage.routesHeading).toBeVisible();
    const r = p.topRoutes[0];
    await expect(airlinePage.routeLabel(r.from, r.to)).toBeVisible();
  });

  test('TC-006-10: Airports section lists the backend\'s top airports', async ({ airlinePage }) => {
    const p = await lookup(airlinePage);
    test.skip(!p.topAirports?.length, `No recorded airports for ${airline.iata} yet`);
    await expect(airlinePage.airportsLabel).toBeVisible();
    await expect(airlinePage.airportsSection).toContainText(p.topAirports[0].iata);
  });

  test('TC-006-11: Fleet section counts the aircraft the backend returned', async ({ airlinePage }) => {
    const p = await lookup(airlinePage);
    test.skip(!p.regs?.length, `No recorded aircraft for ${airline.iata} yet`);
    await expect(airlinePage.fleetHeading(p.regs.length)).toBeVisible();
  });

  test('TC-006-12: fleet section shows the backend\'s registration numbers', async ({ airlinePage }) => {
    const p = await lookup(airlinePage);
    test.skip(!p.regs?.length, `No recorded aircraft for ${airline.iata} yet`);
    for (const reg of p.regs.slice(0, 5)) {
      await expect(airlinePage.registration(reg)).toBeVisible();
    }
  });

  test('TC-006-13: hash routing #airline/IATA navigates to tab and auto-looks up', async ({ page }) => {
    const response = captureApi(page, '/api/airline/profile');
    const app = new AppPage(page);
    await app.gotoViaHash(`airline/${airline.iata}`);
    await app.expectActiveTab('airline');
    const { status, body } = await response;
    expect(status).toBe(200);
    const airlinePage = new AirlinePage(page);
    await airlinePage.waitForProfile();
    await expect(airlinePage.airlineName(body.airline?.name ?? body.iata)).toBeVisible();
  });

  // The real backend answers an unknown airline with an empty profile (200), not an error.
  test('TC-006-14: an unknown airline shows an empty profile with "Not enough data"', async ({ airlinePage }) => {
    const p = await lookup(airlinePage, TEST_DATA.unknownAirlineIata);
    expect(p.airline, 'ZZ should not match a real airline').toBeNull();
    expect(p.observed).toBe(0);

    await expect(airlinePage.airlineName(TEST_DATA.unknownAirlineIata)).toBeVisible();
    await expect(airlinePage.notEnoughData).toBeVisible();
    await expect(airlinePage.observedFlights(0)).toBeVisible();
    await expect(airlinePage.errorBanner).toHaveCount(0);
  });

  test('TC-006-15: airline name click in FlightCard navigates to Airlines tab', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto();
    await app.navigateTo('flight');
    const flightSearch = new FlightSearchPage(page);
    const search = captureApi(page, '/api/search');
    await flightSearch.searchByNumber(flightNumber);
    const { body } = await search;
    await flightSearch.waitForSearchComplete();
    const leg = body.legs[0];
    await flightSearch.airlineButton(leg.airline.name).click();
    await expect(page).toHaveURL(new RegExp(`#airline/${leg.airline.iata}$`));
    await app.expectActiveTab('airline');
  });
});
