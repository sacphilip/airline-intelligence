import { Page, expect } from '@playwright/test';

export class AirlinePage {
  constructor(readonly page: Page) {}

  get iataInput() {
    return this.page.getByPlaceholder(/IATA code/i);
  }

  get searchButton() {
    return this.page.getByRole('button', { name: 'Search' });
  }

  get loadingText() {
    return this.page.getByText('Loading airline profile…');
  }

  get errorBanner() {
    return this.page.locator('[class*="destructive"]');
  }

  async lookup(iata: string) {
    await this.iataInput.fill(iata);
    await this.searchButton.click();
  }

  async waitForProfile(timeout = 15_000) {
    await expect(this.loadingText).toBeHidden({ timeout });
    await expect(
      this.page.getByText(/\/100/i).or(this.page.getByText('Not enough data'))
    ).toBeVisible({ timeout });
  }

  // Score ring container — the overview section has score + /100
  get scoreDisplay() {
    return this.page.locator('span').filter({ hasText: /\/100/ });
  }

  section(title: string) {
    return this.page.locator('section').filter({ has: this.page.getByText(title, { exact: true }) });
  }

  get overviewSection() {
    return this.page.locator('.rounded-xl.border').filter({ hasText: /\/100|Not enough/ });
  }
}
