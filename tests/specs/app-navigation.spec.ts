/**
 * App navigation — smoke tests for shell chrome and tab routing.
 * No API calls required.
 */

import { test, expect } from '../fixtures/test.fixture';
import { AppPage } from '../pages/AppPage';

test.describe('App navigation', () => {
  test('TC-NAV-01: page loads and shows Flight Tracker header', async ({ app }) => {
    await expect(app.appTitle).toBeVisible();
  });

  test('TC-NAV-02: all four tabs are visible', async ({ app }) => {
    await expect(app.tabButton('map')).toBeVisible();
    await expect(app.tabButton('flight')).toBeVisible();
    await expect(app.tabButton('delays')).toBeVisible();
    await expect(app.tabButton('airline')).toBeVisible();
  });

  test('TC-NAV-03: Live Map tab is active by default', async ({ app }) => {
    await app.expectActiveTab('map');
  });

  test('TC-NAV-04: clicking Find Flight tab activates it', async ({ app }) => {
    await app.navigateTo('flight');
    await app.expectActiveTab('flight');
  });

  test('TC-NAV-05: clicking Delays tab activates it', async ({ app }) => {
    await app.navigateTo('delays');
    await app.expectActiveTab('delays');
  });

  test('TC-NAV-06: clicking Airlines tab activates it', async ({ app }) => {
    await app.navigateTo('airline');
    await app.expectActiveTab('airline');
  });

  test('TC-NAV-07: hash routing #flight navigates to Find Flight tab', async ({ page }) => {
    const app = new AppPage(page);
    await app.gotoViaHash('flight');
    await app.expectActiveTab('flight');
  });

  test('TC-NAV-08: hash routing #delays navigates to Delays tab', async ({ page }) => {
    const app = new AppPage(page);
    await app.gotoViaHash('delays');
    await app.expectActiveTab('delays');
  });

  test('TC-NAV-09: hash routing #airline navigates to Airlines tab', async ({ page }) => {
    const app = new AppPage(page);
    await app.gotoViaHash('airline');
    await app.expectActiveTab('airline');
  });

  test('TC-NAV-10: dark/light mode toggle exists', async ({ app }) => {
    const toggle = app.page.locator('button[title*="mode"]');
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(toggle).toBeVisible();
  });
});
