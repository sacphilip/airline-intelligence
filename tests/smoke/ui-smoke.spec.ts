/**
 * UI Smoke Tests — SM-UI-01 through SM-UI-06
 *
 * Mocks every API call with page.route() so no backend or database is needed.
 * Covers the three critical user-facing flows: flight search, route analytics,
 * and airline profile. These must pass for a PR merge status to be green.
 */
import { test, expect, Page } from '@playwright/test';
import { AppPage, AppTab } from '../pages/AppPage';
import { FlightSearchPage } from '../pages/FlightSearchPage';
import { AirlinePage } from '../pages/AirlinePage';

// ── Minimal mock responses ───────────────────────────────────────────────────

const MOCK_SEARCH = {
  source: 'smoke-mock', scheduleAvailable: true, query: '6E 5321',
  legs: [{
    number: '6E 5321', callsign: '6E5321',
    airline: { iata: '6E', icao: 'IGO', name: 'IndiGo' },
    status: 'Expected', statusInferred: false,
    origin: {
      airport: { iata: 'BLR', icao: 'VOBL', name: 'Kempegowda International', city: 'Bengaluru', lat: 13.19, lon: 77.70, timeZone: 'Asia/Kolkata' },
      scheduled: Date.now() + 3_600_000, estimated: null, terminal: '2', gate: 'B4',
    },
    destination: {
      airport: { iata: 'DEL', icao: 'VIDP', name: 'Indira Gandhi International', city: 'Delhi', lat: 28.55, lon: 77.10, timeZone: 'Asia/Kolkata' },
      scheduled: Date.now() + 7_200_000, estimated: null, terminal: '3', gate: null,
    },
    aircraft: { registration: 'VT-IZA', model: 'A320neo', hex: null },
    live: null, liveError: null,
  }],
};

const MOCK_ROUTE_ANALYTICS = {
  from: 'BLR', to: 'DEL',
  since: Date.now() - 30 * 24 * 3_600_000,
  minFlights: 5,
  summary: { flights: 1240, avgDelay: 18, onTimePct: 0.82, cancellationRate: 0.014 },
  airlines: [
    { iata: '6E', name: 'IndiGo',    flights: 820, completed: 810, onTimePct: 0.86, avgDelay: 15, cancellationRate: 0.012, score: 82 },
    { iata: 'AI', name: 'Air India', flights: 420, completed: 415, onTimePct: 0.75, avgDelay: 24, cancellationRate: 0.017, score: 68 },
  ],
  insufficient: [],
};

const MOCK_AIRLINE_PROFILE = {
  iata: '6E', airline: { iata: '6E', icao: 'IGO', name: 'IndiGo' },
  observed: 12400, cancelled: 180, total: 12580,
  onTimePct: 0.84, avgDelay: 17, delayStddev: 14, cancellationRate: 0.014,
  score: 80,
  delayDist: { early: 200, ontime: 10200, slight: 1400, moderate: 400, severe: 200 },
  topRoutes: [{ from: 'BLR', to: 'DEL', count: 820 }],
  topAirports: [{ iata: 'BLR', count: 4200 }],
  regs: ['VT-IZA', 'VT-IZB'],
};

// ── Install all mocks before each test ──────────────────────────────────────

async function mockApi(page: Page) {
  await page.route('**/api/search**',          r => r.fulfill({ json: MOCK_SEARCH }));
  await page.route('**/api/route/analytics**', r => r.fulfill({ json: MOCK_ROUTE_ANALYTICS }));
  await page.route('**/api/airline/profile**', r => r.fulfill({ json: MOCK_AIRLINE_PROFILE }));
  await page.route('**/api/airline/rankings**',r => r.fulfill({ json: [] }));
  await page.route('**/api/airline/trend**',   r => r.fulfill({ json: { iata: '6E', months: [], pctChange: null, direction: 'stable' } }));
  await page.route('**/api/delays**',          r => r.fulfill({ json: { airport: 'BLR', fetchedAt: Date.now(), flights: [] } }));
  await page.route('**/api/history**',         r => r.fulfill({ json: { n: 0, since: null } }));
  await page.route('**/api/aircraft**',        r => r.fulfill({ json: [] }));
  await page.route('**/api/flight**',          r => r.fulfill({ json: null }));
}

// ── App shell ────────────────────────────────────────────────────────────────

const ALL_TABS: AppTab[] = ['map', 'flight', 'delays', 'airline'];

test('SM-UI-01: page loads and shows all four navigation tabs', async ({ page }) => {
  const app = new AppPage(page);
  await mockApi(page);
  await app.goto();
  for (const tab of ALL_TABS) {
    await expect(app.tabButton(tab)).toBeVisible();
  }
});

test('SM-UI-02: switching between tabs does not crash the page', async ({ page }) => {
  const app = new AppPage(page);
  await mockApi(page);
  await page.goto('/');
  for (const tab of ['flight', 'delays', 'airline', 'map'] as AppTab[]) {
    await app.navigateTo(tab);
    // No uncaught JS error dialog
    await expect(app.body).not.toBeEmpty();
  }
});

// ── Flight search ────────────────────────────────────────────────────────────

test('SM-UI-03: flight number search renders a FlightCard with the airline name', async ({ page }) => {
  const app = new AppPage(page);
  const flightSearch = new FlightSearchPage(page);
  await mockApi(page);
  await page.goto('/');
  await app.navigateTo('flight');
  await flightSearch.flightNumberInput.fill('6E 5321');
  await flightSearch.searchButton.click();
  await expect(flightSearch.cardText('6E 5321')).toBeVisible();
  await expect(flightSearch.airlineButton('IndiGo')).toBeVisible();
});

test('SM-UI-04: route mode shows analytics panel and airline comparison table', async ({ page }) => {
  const app = new AppPage(page);
  const flightSearch = new FlightSearchPage(page);
  await mockApi(page);
  await page.goto('/');
  await app.navigateTo('flight');
  await flightSearch.selectRouteMode();
  await flightSearch.fromInput.fill('BLR');
  await flightSearch.toInput.fill('DEL');
  await flightSearch.searchButton.click();
  await expect(flightSearch.analytics.panel).toBeVisible();
  await expect(flightSearch.analytics.flights).toBeVisible();
  await expect(flightSearch.analytics.airlinesTable).toBeVisible();
});

// ── Airline tab ───────────────────────────────────────────────────────────────

test('SM-UI-05: airline tab renders the IATA search form', async ({ page }) => {
  const app = new AppPage(page);
  const airlinePage = new AirlinePage(page);
  await mockApi(page);
  await page.goto('/');
  await app.navigateTo('airline');
  await expect(airlinePage.iataInput).toBeVisible();
});

test('SM-UI-06: airline profile lookup renders the profile with score and metrics', async ({ page }) => {
  const app = new AppPage(page);
  const airlinePage = new AirlinePage(page);
  await mockApi(page);
  await page.goto('/');
  await app.navigateTo('airline');
  await airlinePage.iataInput.fill('6E');
  await airlinePage.iataInput.press('Enter');
  await expect(airlinePage.airlineName('IndiGo')).toBeVisible();
  await expect(airlinePage.scoreValue(80)).toBeVisible();
});
