/**
 * US-003 — Flight card
 *
 * Runs against the real backend. Every value on the card is checked against
 * the backend's response for the same search, formatted with the frontend's
 * own helpers, so the test follows live data without fixed expectations.
 */

import { test, expect } from '../fixtures/test.fixture';
import { FlightSearchPage } from '../pages/FlightSearchPage';
import { TEST_DATA } from '../data/test-data';
import { captureApi, pickLiveFlight } from '../support/live';
import { flightStatus, fmtDelayMinutes } from '../../frontend/src/lib/flight-status';
import { airportCode, fmtClock } from '../../frontend/src/lib/format';

let flightNumber: string;

test.beforeAll(async ({ playwright }) => {
  const request = await playwright.request.newContext();
  ({ number: flightNumber } = await pickLiveFlight(request, TEST_DATA.routeFrom, TEST_DATA.routeTo));
  await request.dispose();
});

async function search(flightSearch: FlightSearchPage) {
  const response = captureApi(flightSearch.page, '/api/search');
  await flightSearch.searchByNumber(flightNumber);
  const { status, body } = await response;
  expect(status, `search ${flightNumber}`).toBe(200);
  await flightSearch.waitForSearchComplete();
  return body.legs[0];
}

// What FlightCard renders for each info cell, from frontend/src/components/flight/FlightSearchTab.tsx.
function expectedCells(leg: any) {
  const depTz = leg.origin.airport?.timeZone;
  const arrTz = leg.destination.airport?.timeZone;
  const { depDelay, arrDelay } = flightStatus(leg);
  return {
    STD: fmtClock(leg.origin.scheduled, depTz) || '—',
    ETD: fmtClock(leg.origin.estimated ?? leg.origin.scheduled, depTz) || '—',
    STA: fmtClock(leg.destination.scheduled, arrTz) || '—',
    ETA: fmtClock(leg.destination.estimated ?? leg.destination.scheduled, arrTz) || '—',
    Delay: fmtDelayMinutes(arrDelay ?? depDelay) || '—',
  };
}

test.describe('US-003 — Flight card', () => {
  test('TC-003-01: FlightCard shows the flight number from the backend', async ({ flightSearch }) => {
    const leg = await search(flightSearch);
    await expect(flightSearch.cardText(leg.number)).toBeVisible();
  });

  for (const label of ['STD', 'ETD', 'STA', 'ETA', 'Delay'] as const) {
    test(`TC-003-${label}: ${label} cell shows the backend's time for this flight`, async ({ flightSearch }) => {
      const leg = await search(flightSearch);
      await expect(flightSearch.infoValue(label)).toHaveText(expectedCells(leg)[label]);
    });
  }

  test('TC-003-07: FlightCard shows Status label', async ({ flightSearch }) => {
    await search(flightSearch);
    await expect(flightSearch.infoLabel('Status')).toBeVisible();
  });

  test('TC-003-08: status badge matches the live status and its detail', async ({ flightSearch }) => {
    const leg = await search(flightSearch);
    const expected = flightStatus(leg);
    await expect(flightSearch.statusPill).toContainText(expected.text);
    if (expected.detail) await expect(flightSearch.statusDetail(expected.detail)).toBeVisible();
  });

  test('TC-003-09: FlightCard shows origin and destination airport codes', async ({ flightSearch }) => {
    const leg = await search(flightSearch);
    await expect(flightSearch.cardText(airportCode(leg.origin.airport))).toBeVisible();
    await expect(flightSearch.cardText(airportCode(leg.destination.airport))).toBeVisible();
  });

  test('TC-003-10: clicking airline name navigates to #airline/{iata}', async ({ flightSearch, app }) => {
    const leg = await search(flightSearch);
    await flightSearch.airlineButton(leg.airline.name).click();
    await expect(flightSearch.page).toHaveURL(new RegExp(`#airline/${leg.airline.iata}$`));
    await app.expectActiveTab('airline');
  });
});
