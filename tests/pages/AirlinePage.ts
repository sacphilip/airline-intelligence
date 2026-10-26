import { Page, expect } from '@playwright/test';
import { Locators } from '../support/locators';
import airlineLocators from '../locators/airline.locators.json';

export class AirlinePage {
  private readonly loc: Locators<keyof typeof airlineLocators>;

  constructor(readonly page: Page) {
    this.loc = new Locators(page, airlineLocators, 'airline.locators.json');
  }

  // ── Search form ──────────────────────────────────────────────────────────────

  get iataInput()    { return this.loc.get('iataInput'); }
  get searchButton() { return this.loc.get('searchButton'); }

  async lookup(iata: string) {
    await this.iataInput.fill(iata);
    await this.searchButton.click();
  }

  async waitForProfile(timeout = 15_000) {
    await expect(this.loadingText).toBeHidden({ timeout });
    await expect(this.scoreOrEmpty).toBeVisible({ timeout });
  }

  // ── State indicators ─────────────────────────────────────────────────────────

  get loadingText()   { return this.loc.get('loadingText'); }
  get errorBanner()   { return this.loc.get('errorBanner'); }
  get notEnoughData() { return this.loc.get('notEnoughData'); }
  get scoreOrEmpty()  { return this.loc.get('scoreOrEmpty'); }
  get scoreOutOf()    { return this.loc.get('scoreOutOf'); }

  scoreValue(score: number | string) {
    return this.loc.get('scoreValue', { score });
  }

  observedFlights(count: number) {
    return this.loc.get('observedFlights', { count });
  }

  // ── Profile content ──────────────────────────────────────────────────────────

  airlineName(name: string) {
    return this.loc.get('airlineName', { name });
  }

  get overviewSection()       { return this.loc.get('overviewSection'); }
  get scoreBreakdownHeading() { return this.loc.get('scoreBreakdownHeading'); }
  get delayAnalysis()         { return this.loc.get('delayAnalysis'); }
  get routesHeading()         { return this.loc.get('routesHeading'); }
  get airportsLabel()         { return this.loc.get('airportsLabel'); }
  get airportsSection()       { return this.loc.get('airportsSection'); }

  routeLabel(from: string, to: string) {
    return this.loc.get('routeLabel', { from, to });
  }

  fleetHeading(count: number) {
    return this.loc.get('fleetHeading', { count });
  }

  registration(reg: string) {
    return this.loc.get('registration', { reg });
  }
}
