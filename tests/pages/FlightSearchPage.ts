import { Page, expect } from '@playwright/test';

export class FlightSearchPage {
  constructor(readonly page: Page) {}

  // ── Mode toggle ──────────────────────────────────────────────────────────────

  async selectNumberMode() {
    await this.page.getByRole('button', { name: /Flight number/i }).click();
  }

  async selectRouteMode() {
    await this.page.getByRole('button', { name: /Route/i }).click();
  }

  // ── Number search inputs ─────────────────────────────────────────────────────

  get flightNumberInput() {
    return this.page.getByPlaceholder(/6E 5321/i);
  }

  get dateInput() {
    return this.page.locator('input[type="date"]').first();
  }

  get searchButton() {
    return this.page.getByRole('button', { name: 'Search' });
  }

  async searchByNumber(flightNumber: string, date?: string) {
    await this.selectNumberMode();
    await this.flightNumberInput.fill(flightNumber);
    if (date) await this.dateInput.fill(date);
    await this.searchButton.click();
  }

  // ── Route search inputs ──────────────────────────────────────────────────────

  get fromInput() {
    return this.page.getByPlaceholder('From (BLR)');
  }

  get toInput() {
    return this.page.getByPlaceholder('To (DEL)');
  }

  async searchByRoute(from: string, to: string, date: string) {
    await this.selectRouteMode();
    await this.fromInput.fill(from);
    await this.toInput.fill(to);
    await this.page.locator('input[type="date"]').fill(date);
    await this.searchButton.click();
  }

  // ── State indicators ─────────────────────────────────────────────────────────

  get loadingText() {
    return this.page.getByText('Looking up flight…');
  }

  get errorBanner() {
    return this.page.locator('[class*="destructive"]');
  }

  async waitForSearchComplete(timeout = 20_000) {
    await expect(this.loadingText).toBeHidden({ timeout });
  }

  // ── Flight card ──────────────────────────────────────────────────────────────

  get flightCard() {
    return this.page.locator('.rounded-xl.border').filter({ hasText: /STD|Sched/i }).first();
  }

  infoCell(label: string) {
    return this.page.getByText(label, { exact: true });
  }

  /** The value shown under an info-row label (STD, ETD, STA, ETA, Delay) on the first card. */
  infoValue(label: string) {
    return this.page
      .locator('div.px-3.py-3')
      .filter({ has: this.page.locator('span.font-bold', { hasText: new RegExp(`^${label}$`) }) })
      .first()
      .locator('div.tabular-nums');
  }

  /** The status pill on the first card (icon + text). */
  get statusPill() {
    return this.page
      .locator('div.px-4.py-3.flex-col')
      .filter({ has: this.page.locator('span', { hasText: /^Status$/ }) })
      .first()
      .locator('span.rounded-full');
  }

  // ── Flight history ────────────────────────────────────────────────────────────

  get flightHistoryToggle() {
    return this.page.getByRole('button', { name: /Flight history · last 7 days/i });
  }

  get flightHistoryTable() {
    return this.page.locator('table').filter({ hasText: /Date/i });
  }

  get noHistoryMessage() {
    return this.page.getByText('No history data available');
  }

  // ── Route table ──────────────────────────────────────────────────────────────

  get statsBar() {
    return this.page.locator('.grid.grid-cols-4');
  }

  get filterChips() {
    return this.page.locator('button').filter({ hasText: /All|On time|Delayed|Airborne|Landed|Cancelled/i });
  }

  // The day's flight list: the table with a "Dep" column. Other tables stay in the page too:
  // the route-analytics airlines table (US-009) and the hidden Airlines tab's rankings table.
  get routeTable() {
    return this.page.locator('table').filter({ has: this.page.locator('th', { hasText: /^Dep/ }) });
  }

  get routeTableRows() {
    return this.routeTable.locator('tbody tr');
  }

  sortableHeader(name: string) {
    return this.page.getByRole('button', { name: new RegExp(name, 'i') }).filter({ hasText: /⇅|▲|▼/ });
  }
}
