import { Page, expect } from '@playwright/test';
import { Locators } from '../support/locators';
import flightLocators from '../locators/flight-search.locators.json';
import { RouteAnalyticsPanel } from './RouteAnalyticsPanel';

export class FlightSearchPage {
  private readonly loc: Locators<keyof typeof flightLocators>;
  readonly analytics: RouteAnalyticsPanel;

  constructor(readonly page: Page) {
    this.loc = new Locators(page, flightLocators, 'flight-search.locators.json');
    this.analytics = new RouteAnalyticsPanel(page);
  }

  // ── Search form ──────────────────────────────────────────────────────────────

  get numberModeButton()  { return this.loc.get('numberModeButton'); }
  get routeModeButton()   { return this.loc.get('routeModeButton'); }
  get flightNumberInput() { return this.loc.get('flightNumberInput'); }
  get fromInput()         { return this.loc.get('fromInput'); }
  get toInput()           { return this.loc.get('toInput'); }
  get dateInput()         { return this.loc.get('dateInput'); }
  get searchButton()      { return this.loc.get('searchButton'); }

  async selectNumberMode() {
    await this.numberModeButton.click();
  }

  async selectRouteMode() {
    await this.routeModeButton.click();
  }

  async searchByNumber(flightNumber: string, date?: string) {
    await this.selectNumberMode();
    await this.flightNumberInput.fill(flightNumber);
    if (date) await this.dateInput.fill(date);
    await this.searchButton.click();
  }

  async searchByRoute(from: string, to: string, date: string) {
    await this.selectRouteMode();
    await this.fromInput.fill(from);
    await this.toInput.fill(to);
    await this.dateInput.fill(date);
    await this.searchButton.click();
  }

  // ── State indicators ─────────────────────────────────────────────────────────

  get loadingText()      { return this.loc.get('loadingText'); }
  get errorBanner()      { return this.loc.get('errorBanner'); }
  get airportCodeError() { return this.loc.get('airportCodeError'); }

  async waitForSearchComplete(timeout = 20_000) {
    await expect(this.loadingText).toBeHidden({ timeout });
  }

  // ── Flight card ──────────────────────────────────────────────────────────────

  /** Text shown on the card exactly as given: a flight number, an airport code. */
  cardText(text: string) {
    return this.loc.get('cardText', { text });
  }

  airlineButton(name: string) {
    return this.loc.get('airlineButton', { name });
  }

  /** An info-row label: STD, ETD, STA, ETA, Delay or Status. */
  infoLabel(label: string) {
    return this.loc.get('infoLabel', { label });
  }

  /** The value shown under an info-row label (STD, ETD, STA, ETA, Delay) on the first card. */
  infoValue(label: string) {
    return this.loc.get('infoValue', { label });
  }

  /** The status pill on the first card (icon + text). */
  get statusPill() { return this.loc.get('statusPill'); }

  statusDetail(detail: string) {
    return this.loc.get('statusDetail', { detail });
  }

  // ── Flight history ───────────────────────────────────────────────────────────

  get flightHistoryToggle() { return this.loc.get('flightHistoryToggle'); }
  get flightHistoryHeader() { return this.loc.get('flightHistoryHeader'); }
  get flightHistoryTable()  { return this.loc.get('flightHistoryTable'); }
  get historyRows()         { return this.loc.get('historyRows'); }
  get noHistoryMessage()    { return this.loc.get('noHistoryMessage'); }

  historyColumnHeader(name: string) {
    return this.loc.get('historyColumnHeader', { name });
  }

  historyRow(row: number) {
    return this.loc.get('historyRow', { row });
  }

  historyDelayCell(row: number) {
    return this.loc.get('historyDelayCell', { row });
  }

  // ── Route results ────────────────────────────────────────────────────────────

  get statsBar() { return this.loc.get('statsBar'); }

  /** The number on a stats-bar tile: Total, Delayed, Cancelled, … */
  statValue(label: string) {
    return this.loc.get('statValue', { label });
  }

  /** The filter chip for a status; the label and count are separate spans. */
  statusChip(label: string) {
    return this.loc.get('statusChip', { label });
  }

  /** The first filter chip other than All. */
  get nonAllChip() { return this.loc.get('nonAllChip'); }

  // The day's flight list: the table with a "Dep" column. Other tables stay in the page too:
  // the route-analytics airlines table (US-009) and the hidden Airlines tab's rankings table.
  get routeTableRows() { return this.loc.get('routeTableRows'); }

  routeRow(flightNumber: string) {
    return this.loc.get('routeRow', { number: flightNumber });
  }
}
