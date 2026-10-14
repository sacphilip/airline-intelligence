/**
 * US-006 — Airline profile
 * Runs against the real backend — no API mocks.
 * Assertions are written to pass whether or not the database has historical data
 * for the searched airline (profile may show real values or "—" / "Not enough data").
 */
import { test, expect } from '../fixtures/test.fixture';
import { AppPage } from '../pages/AppPage';
import { AirlinePage } from '../pages/AirlinePage';

test.describe('US-006 — Airline profile', () => {

  // ── Navigation ──────────────────────────────────────────────────────────────

  // AC-01 — P0
  test('TC-006-01: Airlines tab is accessible from main navigation', async ({ app }) => {
    await app.navigateTo('airline');
    await app.expectActiveTab('airline');
  });

  // ── Profile structure (data-independent) ───────────────────────────────────

  // AC-01 — P1
  test('TC-006-02: Searching a valid IATA code renders the overview section', async ({ airlinePage }) => {
    await airlinePage.searchAndWaitForProfile('6E');
    await expect(airlinePage.scoreOrEmpty).toBeVisible();
    await expect(airlinePage.errorBanner).not.toBeVisible();
  });

  // AC-02 — P1
  test('TC-006-03: Overview section shows score ring or not-enough-data state', async ({ airlinePage }) => {
    await airlinePage.searchAndWaitForProfile('6E');
    await expect(airlinePage.scoreOrEmpty).toBeVisible();
  });

  // AC-03 — P1
  test('TC-006-04: On-time metric label is present in the overview', async ({ airlinePage }) => {
    await airlinePage.searchAndWaitForProfile('6E');
    await expect(airlinePage.onTimeLabel).toBeVisible();
  });

  // AC-04 — P1
  test('TC-006-05: Average delay metric label is present in the overview', async ({ airlinePage }) => {
    await airlinePage.searchAndWaitForProfile('6E');
    await expect(airlinePage.avgDelayLabel).toBeVisible();
  });

  // AC-05 — P2
  test('TC-006-06: Cancellation metric label is present in the overview', async ({ airlinePage }) => {
    await airlinePage.searchAndWaitForProfile('6E');
    await expect(airlinePage.cancellationLabel).toBeVisible();
  });

  // AC-06 — P2 (only if score exists)
  test('TC-006-07: Score breakdown section shows all four component bars when a score is available', async ({ airlinePage }) => {
    await airlinePage.searchAndWaitForProfile('6E');
    if (!await airlinePage.hasScore()) {
      test.skip();
      return;
    }
    await expect(airlinePage.scoreBreakdownHeading).toBeVisible();
    for (const label of ['On-time performance', 'Cancellation rate', 'Average delay', 'Delay consistency'] as const) {
      await expect(airlinePage.breakdownLabel(label)).toBeVisible();
    }
  });

  // AC-07 — P2 (only if observed > 0)
  test('TC-006-08: Delay analysis section renders five buckets when flights are observed', async ({ airlinePage }) => {
    await airlinePage.searchAndWaitForProfile('6E');
    if (!await airlinePage.delayAnalysisHeading.isVisible()) {
      test.skip();
      return;
    }
    for (const bucket of ['Early', 'On time', '+15–30 min', '+30–60 min', '+60 min'] as const) {
      await expect(airlinePage.delayBucket(bucket)).toBeVisible();
    }
  });

  // AC-08 — P2 (only if topRoutes populated)
  test('TC-006-09: Routes section renders when route data is available', async ({ airlinePage }) => {
    await airlinePage.searchAndWaitForProfile('6E');
    if (!await airlinePage.routesHeading.isVisible()) {
      test.skip();
      return;
    }
    await expect(airlinePage.routeArrow).toBeVisible();
  });

  // AC-09 — P2 (only if topAirports populated)
  test('TC-006-10: Airports section renders when airport data is available', async ({ airlinePage }) => {
    await airlinePage.searchAndWaitForProfile('6E');
    if (!await airlinePage.airportsHeading.isVisible()) {
      test.skip();
      return;
    }
    await expect(airlinePage.airportChip).toBeVisible();
  });

  // AC-10 — P2 (only if fleet populated)
  test('TC-006-11: Fleet section renders when registration data is available', async ({ airlinePage }) => {
    await airlinePage.searchAndWaitForProfile('6E');
    if (!await airlinePage.fleetHeading.isVisible()) {
      test.skip();
      return;
    }
    await expect(airlinePage.fleetChip).toBeVisible();
  });

  // ── Input validation & error states ────────────────────────────────────────

  // NEG-01 — P0
  test('TC-006-12: Submitting empty IATA input does not load a profile', async ({ airlinePage }) => {
    await airlinePage.searchButton.click();
    await expect(airlinePage.loadingText).not.toBeVisible();
    await expect(airlinePage.scoreOrEmpty).not.toBeVisible();
  });

  // NEG-01 — P1
  test('TC-006-13: Searching a numeric-only IATA shows an error banner', async ({ airlinePage }) => {
    await airlinePage.lookup('12345');
    await expect(airlinePage.errorOrInvalidMessage).toBeVisible({ timeout: 15_000 });
  });

  // NEG-01 — P1
  test('TC-006-14: Loading indicator is visible while profile is being fetched', async ({ airlinePage }) => {
    await airlinePage.iataInput.fill('6E');
    await airlinePage.searchButton.click();
    await expect(airlinePage.loadingText).toBeVisible();
    await expect(airlinePage.loadingText).toBeHidden({ timeout: 15_000 });
  });

  // AC-01 — P1 (hash routing — uses raw page to test deep-link navigation)
  test('TC-006-15: Hash routing #airline/6E opens Airlines tab and pre-fills IATA input', async ({ page }) => {
    const app = new AppPage(page);
    await app.gotoViaHash('airline/6E');
    await app.expectActiveTab('airline');
    const airline = new AirlinePage(page);
    await expect(airline.iataInput).toHaveValue('6E');
  });

  // NEG-01 — P2 (no-data empty state)
  test('TC-006-16: Airline with no historical data shows the empty state message', async ({ airlinePage }) => {
    await airlinePage.lookup('ZZ');
    await expect(airlinePage.loadingText).toBeHidden({ timeout: 15_000 });
    await expect(airlinePage.emptyStateMessage).toBeVisible();
  });

});
