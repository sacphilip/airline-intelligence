import { Page, expect } from '@playwright/test';
import { AirlineLocators } from '../locators/airline.locators';

export class AirlinePage {
  constructor(readonly page: Page) {}

  // ── Inputs ──────────────────────────────────────────────────────────────────

  get iataInput() {
    return this.page.getByPlaceholder(AirlineLocators.iataInput);
  }

  get searchButton() {
    return this.page.getByRole('button', { name: AirlineLocators.searchButton });
  }

  // ── State indicators ────────────────────────────────────────────────────────

  get loadingText() {
    return this.page.getByText(AirlineLocators.loadingText);
  }

  get errorBanner() {
    return this.page.locator(AirlineLocators.errorBanner);
  }

  get scoreOrEmpty() {
    return this.page
      .getByText(AirlineLocators.scoreText)
      .or(this.page.getByText(AirlineLocators.notEnoughData));
  }

  get errorOrInvalidMessage() {
    return this.errorBanner.or(this.page.getByText(AirlineLocators.errorPattern));
  }

  get emptyStateMessage() {
    return this.page.getByText(AirlineLocators.emptyStateText).or(this.errorBanner);
  }

  // ── Metric labels ────────────────────────────────────────────────────────────

  get onTimeLabel() {
    return this.page.getByText(AirlineLocators.onTimeLabel, { exact: true });
  }

  get avgDelayLabel() {
    return this.page.getByText(AirlineLocators.avgDelayLabel, { exact: true });
  }

  get cancellationLabel() {
    return this.page.getByText(AirlineLocators.cancellationLabel, { exact: true });
  }

  // ── Section headings ─────────────────────────────────────────────────────────

  get scoreBreakdownHeading() {
    return this.page.getByRole('heading', { name: AirlineLocators.scoreBreakdownHeading });
  }

  get delayAnalysisHeading() {
    return this.page.getByRole('heading', { name: AirlineLocators.delayAnalysisHeading });
  }

  get routesHeading() {
    return this.page.getByRole('heading', { name: AirlineLocators.routesHeading });
  }

  get airportsHeading() {
    return this.page.getByRole('heading', { name: AirlineLocators.airportsHeading });
  }

  get fleetHeading() {
    return this.page.getByRole('heading', { name: AirlineLocators.fleetHeading });
  }

  // ── Content locators ─────────────────────────────────────────────────────────

  breakdownLabel(label: typeof AirlineLocators.breakdownLabels[number]) {
    return this.page.getByText(label, { exact: true });
  }

  delayBucket(label: typeof AirlineLocators.delayBuckets[number]) {
    return this.page.getByText(label, { exact: true });
  }

  get routeArrow() {
    return this.page.locator('span').filter({ hasText: AirlineLocators.routeArrow }).first();
  }

  get airportChip() {
    return this.page
      .locator('section')
      .filter({ has: this.airportsHeading })
      .locator(AirlineLocators.airportChip)
      .first();
  }

  get fleetChip() {
    return this.page
      .locator('section')
      .filter({ has: this.fleetHeading })
      .locator(AirlineLocators.airportChip)
      .first();
  }

  // ── Actions ──────────────────────────────────────────────────────────────────

  async lookup(iata: string) {
    await this.iataInput.fill(iata);
    await this.searchButton.click();
  }

  async searchAndWaitForProfile(iata: string, timeout = 15_000) {
    await this.lookup(iata);
    await expect(this.loadingText).toBeHidden({ timeout });
  }

  async hasScore(): Promise<boolean> {
    return this.page.getByText(AirlineLocators.scoreText).isVisible();
  }

  async hasSection(heading: typeof AirlineLocators.scoreBreakdownHeading
    | typeof AirlineLocators.delayAnalysisHeading
    | typeof AirlineLocators.routesHeading
    | typeof AirlineLocators.airportsHeading
    | RegExp): Promise<boolean> {
    return this.page.getByRole('heading', { name: heading }).isVisible();
  }

  // ── Legacy aliases (used by other specs) ─────────────────────────────────────

  /** @deprecated use searchAndWaitForProfile */
  async waitForProfile(timeout = 15_000) {
    await expect(this.loadingText).toBeHidden({ timeout });
    await expect(this.scoreOrEmpty).toBeVisible({ timeout });
  }

  get scoreDisplay() {
    return this.page.locator('span').filter({ hasText: AirlineLocators.scoreText });
  }

  section(title: string) {
    return this.page
      .locator('section')
      .filter({ has: this.page.getByText(title, { exact: true }) });
  }

  get overviewSection() {
    return this.page
      .locator('.rounded-xl.border')
      .filter({ hasText: /\/100|Not enough/ });
  }
}
