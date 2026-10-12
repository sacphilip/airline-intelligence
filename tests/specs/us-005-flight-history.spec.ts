/**
 * US-005 — Flight history
 *
 * Runs against the real backend. The history is whatever the backend has
 * recorded for a real flight; each test checks the UI against that response.
 * Cases the live data doesn't contain today (e.g. no cancellation in the last
 * 7 days) are skipped with a reason rather than faked.
 */

import { test, expect } from '../fixtures/test.fixture';
import { FlightSearchPage } from '../pages/FlightSearchPage';
import { TEST_DATA } from '../data/test-data';
import { captureApi, pickLiveFlight } from '../support/live';
import { fmtDelayMinutes } from '../../frontend/src/lib/flight-status';

let flightNumber: string;

test.beforeAll(async ({ playwright }) => {
  const request = await playwright.request.newContext();
  ({ number: flightNumber } = await pickLiveFlight(request, TEST_DATA.routeFrom, TEST_DATA.routeTo));
  await request.dispose();
});

/** Search, then wait for the history request the card makes and return its rows. */
async function searchWithHistory(flightSearch: FlightSearchPage) {
  const search = captureApi(flightSearch.page, '/api/search');
  const history = captureApi(flightSearch.page, '/api/flight/history');
  history.catch(() => {}); // not awaited if the schedule source is unavailable
  await flightSearch.searchByNumber(flightNumber);
  const { status, body } = await search;
  expect(status, `search ${flightNumber}`).toBe(200);
  expect(body.scheduleAvailable, 'the backend needs AERODATABOX_KEY for flight history').toBe(true);
  await flightSearch.waitForSearchComplete();

  const { status: hStatus, body: rows } = await history;
  expect(hStatus).toBe(200);
  return rows as any[];
}

// The label FlightHistory renders in the Delay column.
const delayLabel = (r: any) => (r.cancelled ? 'Cancelled' : fmtDelayMinutes(r.delay ?? null) || 'On time');

test.describe('US-005 — Flight history', () => {
  test('TC-005-01: flight history section appears below FlightCard', async ({ flightSearch }) => {
    await searchWithHistory(flightSearch);
    await expect(flightSearch.flightHistoryToggle).toBeVisible();
  });

  test('TC-005-02: section header reads "Flight history · last 7 days"', async ({ flightSearch }) => {
    await searchWithHistory(flightSearch);
    await expect(flightSearch.page.getByText(/Flight history · last 7 days/i)).toBeVisible();
  });

  test('TC-005-03: history shows a table or the no-data message, matching the backend', async ({ flightSearch }) => {
    const rows = await searchWithHistory(flightSearch);
    if (rows.length === 0) {
      await expect(flightSearch.noHistoryMessage).toBeVisible();
      await expect(flightSearch.flightHistoryTable).toHaveCount(0);
    } else {
      await expect(flightSearch.flightHistoryTable.getByRole('columnheader', { name: 'Date' })).toBeVisible();
      await expect(flightSearch.flightHistoryTable.getByRole('columnheader', { name: 'Delay' })).toBeVisible();
    }
  });

  test('TC-005-04: history table has one row per day the backend returned', async ({ flightSearch }) => {
    const rows = await searchWithHistory(flightSearch);
    test.skip(rows.length === 0, `No recorded history for ${flightNumber} yet`);
    await expect(flightSearch.flightHistoryTable.locator('tbody tr')).toHaveCount(rows.length);
  });

  test('TC-005-05: each row shows the delay, "On time" or "Cancelled" from the backend', async ({ flightSearch }) => {
    const rows = await searchWithHistory(flightSearch);
    test.skip(rows.length === 0, `No recorded history for ${flightNumber} yet`);
    const bodyRows = flightSearch.flightHistoryTable.locator('tbody tr');
    for (const [i, r] of rows.entries()) {
      await expect(bodyRows.nth(i).locator('td').nth(1)).toHaveText(delayLabel(r));
    }
  });

  test('TC-005-06: a delayed day shows its +N min label', async ({ flightSearch }) => {
    const rows = await searchWithHistory(flightSearch);
    const i = rows.findIndex((r) => !r.cancelled && (r.delay ?? 0) > 0);
    test.skip(i < 0, `No delayed day in ${flightNumber}'s recorded history`);
    await expect(flightSearch.flightHistoryTable.locator('tbody tr').nth(i)).toContainText(`+${rows[i].delay} min`);
  });

  test('TC-005-07: a cancelled day shows "Cancelled"', async ({ flightSearch }) => {
    const rows = await searchWithHistory(flightSearch);
    const i = rows.findIndex((r) => r.cancelled);
    test.skip(i < 0, `No cancelled day in ${flightNumber}'s recorded history`);
    await expect(flightSearch.flightHistoryTable.locator('tbody tr').nth(i)).toContainText('Cancelled');
  });

  test('TC-005-08: clicking toggle collapses history section', async ({ flightSearch }) => {
    await searchWithHistory(flightSearch);
    await flightSearch.flightHistoryToggle.click();
    await expect(flightSearch.flightHistoryTable).toBeHidden();
    await expect(flightSearch.noHistoryMessage).toBeHidden();
  });
});
