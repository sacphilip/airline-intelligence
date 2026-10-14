/**
 * US-006 — Airline profile
 * Runs against the real backend — no API mocks.
 * Assertions are written to pass whether or not the database has historical data
 * for the searched airline (profile may show real values or "—" / "Not enough data").
 */
import { test, expect } from '@playwright/test';

const AIRLINES_NAV = { name: 'Airlines' };
const SEARCH_BTN   = { name: 'Search' };
const IATA_INPUT   = /IATA code/i;

async function goToAirlines(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.locator('nav').getByRole('button', AIRLINES_NAV).click();
}

async function searchAndWait(page: import('@playwright/test').Page, iata: string) {
  await page.getByPlaceholder(IATA_INPUT).fill(iata);
  await page.getByRole('button', SEARCH_BTN).click();
  await expect(page.getByText('Loading airline profile…')).toBeHidden({ timeout: 15_000 });
}

test.describe('US-006 — Airline profile', () => {

  // ── Navigation ──────────────────────────────────────────────────────────────

  // AC-01 — P0
  test('TC-006-01: Airlines tab is accessible from main navigation', async ({ page }) => {
    await goToAirlines(page);
    await expect(page.locator('nav').getByRole('button', AIRLINES_NAV))
      .toHaveAttribute('aria-selected', 'true');
    await expect(page.getByPlaceholder(IATA_INPUT)).toBeVisible();
  });

  // ── Profile structure (data-independent) ───────────────────────────────────

  // AC-01 — P1
  test('TC-006-02: Searching a valid IATA code renders the overview section', async ({ page }) => {
    await goToAirlines(page);
    await searchAndWait(page, '6E');
    // Profile section always renders: shows either a score ring or "Not enough data"
    await expect(
      page.getByText('/100').or(page.getByText('Not enough data'))
    ).toBeVisible();
    // No error banner — the lookup succeeded
    await expect(page.locator('[class*="destructive"]')).not.toBeVisible();
  });

  // AC-02 — P1
  test('TC-006-03: Overview section shows score ring or not-enough-data state', async ({ page }) => {
    await goToAirlines(page);
    await searchAndWait(page, '6E');
    await expect(
      page.getByText('/100').or(page.getByText('Not enough data'))
    ).toBeVisible();
  });

  // AC-03 — P1
  test('TC-006-04: On-time metric label is present in the overview', async ({ page }) => {
    await goToAirlines(page);
    await searchAndWait(page, '6E');
    await expect(page.getByText('On-time', { exact: true })).toBeVisible();
  });

  // AC-04 — P1
  test('TC-006-05: Average delay metric label is present in the overview', async ({ page }) => {
    await goToAirlines(page);
    await searchAndWait(page, '6E');
    await expect(page.getByText('Avg delay', { exact: true })).toBeVisible();
  });

  // AC-05 — P2
  test('TC-006-06: Cancellation metric label is present in the overview', async ({ page }) => {
    await goToAirlines(page);
    await searchAndWait(page, '6E');
    await expect(page.getByText('Cancellation', { exact: true })).toBeVisible();
  });

  // AC-06 — P2 (only if score exists)
  test('TC-006-07: Score breakdown section shows all four component bars when a score is available', async ({ page }) => {
    await goToAirlines(page);
    await searchAndWait(page, '6E');
    const hasScore = await page.getByText('/100').isVisible();
    if (!hasScore) {
      test.skip(); // no historical data — breakdown section not rendered
      return;
    }
    await expect(page.getByRole('heading', { name: 'Reliability score breakdown' })).toBeVisible();
    for (const label of ['On-time performance', 'Cancellation rate', 'Average delay', 'Delay consistency']) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
  });

  // AC-07 — P2 (only if observed > 0)
  test('TC-006-08: Delay analysis section renders five buckets when flights are observed', async ({ page }) => {
    await goToAirlines(page);
    await searchAndWait(page, '6E');
    const hasDelaySection = await page.getByRole('heading', { name: 'Delay analysis' }).isVisible();
    if (!hasDelaySection) {
      test.skip(); // no observed flights yet
      return;
    }
    for (const label of ['Early', 'On time', '+15–30 min', '+30–60 min', '+60 min']) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
  });

  // AC-08 — P2 (only if topRoutes populated)
  test('TC-006-09: Routes section renders when route data is available', async ({ page }) => {
    await goToAirlines(page);
    await searchAndWait(page, '6E');
    const hasRoutes = await page.getByRole('heading', { name: 'Routes' }).isVisible();
    if (!hasRoutes) {
      test.skip();
      return;
    }
    // At least one route entry in the format "XXX → YYY"
    await expect(page.locator('span').filter({ hasText: /→/ }).first()).toBeVisible();
  });

  // AC-09 — P2 (only if topAirports populated)
  test('TC-006-10: Airports section renders when airport data is available', async ({ page }) => {
    await goToAirlines(page);
    await searchAndWait(page, '6E');
    const hasAirports = await page.getByRole('heading', { name: 'Airports' }).isVisible();
    if (!hasAirports) {
      test.skip();
      return;
    }
    // At least one airport chip is visible — scoped to Airports section to avoid
    // matching font-mono spans in the rankings table (which may be off-screen)
    await expect(
      page.locator('section').filter({ has: page.getByRole('heading', { name: 'Airports' }) })
        .locator('span.font-mono').first()
    ).toBeVisible();
  });

  // AC-10 — P2 (only if fleet populated)
  test('TC-006-11: Fleet section renders when registration data is available', async ({ page }) => {
    await goToAirlines(page);
    await searchAndWait(page, '6E');
    const hasFleet = await page.getByRole('heading', { name: /Fleet/ }).isVisible();
    if (!hasFleet) {
      test.skip();
      return;
    }
    // Fleet section has at least one registration chip
    await expect(page.locator('section').filter({ has: page.getByRole('heading', { name: /Fleet/ }) })
      .locator('span.font-mono').first()).toBeVisible();
  });

  // ── Input validation & error states ────────────────────────────────────────

  // NEG-01 — P0
  test('TC-006-12: Submitting empty IATA input does not load a profile', async ({ page }) => {
    await goToAirlines(page);
    await page.getByRole('button', SEARCH_BTN).click();
    // Profile section must not appear — no "airline profile" content rendered
    await expect(page.getByText('Loading airline profile…')).not.toBeVisible();
    await expect(page.getByText('/100')).not.toBeVisible();
    await expect(page.getByText('Not enough data')).not.toBeVisible();
  });

  // NEG-01 — P1 (invalid IATA triggers backend 400 → component shows error banner)
  test('TC-006-13: Searching a numeric-only IATA shows an error banner', async ({ page }) => {
    await goToAirlines(page);
    await page.getByPlaceholder(IATA_INPUT).fill('12345');
    await page.getByRole('button', SEARCH_BTN).click();
    // Either a backend error (400 → error banner) or the frontend shows an appropriate message
    await expect(
      page.locator('[class*="destructive"]').or(page.getByText(/invalid|error|not found/i))
    ).toBeVisible({ timeout: 15_000 });
  });

  // NEG-01 — P1
  test('TC-006-14: Loading indicator is visible while profile is being fetched', async ({ page }) => {
    await goToAirlines(page);
    await page.getByPlaceholder(IATA_INPUT).fill('6E');
    // Click and immediately assert loading — loading appears synchronously on click
    await page.getByRole('button', SEARCH_BTN).click();
    await expect(page.getByText('Loading airline profile…')).toBeVisible();
    // Then confirm it goes away once response arrives
    await expect(page.getByText('Loading airline profile…')).toBeHidden({ timeout: 15_000 });
  });

  // AC-01 — P1 (hash routing)
  test('TC-006-15: Hash routing #airline/6E opens Airlines tab and pre-fills IATA input', async ({ page }) => {
    await page.goto('/#airline/6E');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('nav').getByRole('button', AIRLINES_NAV))
      .toHaveAttribute('aria-selected', 'true');
    await expect(page.getByPlaceholder(IATA_INPUT)).toHaveValue('6E');
  });

  // NEG-01 — P2 (no-data empty state)
  test('TC-006-16: Airline with no historical data shows the empty state message', async ({ page }) => {
    // "ZZ" is not a real airline IATA; the backend will return a profile with observed=0
    // or 404 — either way the component shows an appropriate message
    await goToAirlines(page);
    await page.getByPlaceholder(IATA_INPUT).fill('ZZ');
    await page.getByRole('button', SEARCH_BTN).click();
    await expect(page.getByText('Loading airline profile…')).toBeHidden({ timeout: 15_000 });
    await expect(
      page.getByText(/No historical data/i)
        .or(page.locator('[class*="destructive"]'))
    ).toBeVisible();
  });

});
