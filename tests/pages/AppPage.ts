import { Page, expect } from '@playwright/test';

export type AppTab = 'map' | 'flight' | 'delays' | 'airline';

const TAB_LABELS: Record<AppTab, string> = {
  map: 'Live Map',
  flight: 'Find Flight',
  delays: 'Delays',
  airline: 'Airlines',
};

export class AppPage {
  constructor(readonly page: Page) {}

  async goto() {
    await this.page.goto('/');
    await this.page.waitForLoadState('domcontentloaded');
  }

  async navigateTo(tab: AppTab) {
    await this.page.locator('nav').getByRole('button', { name: TAB_LABELS[tab] }).click();
  }

  async expectActiveTab(tab: AppTab) {
    await expect(
      this.page.locator('nav').getByRole('button', { name: TAB_LABELS[tab] })
    ).toHaveAttribute('aria-selected', 'true');
  }

  async gotoViaHash(hash: string) {
    await this.page.goto(`/#${hash}`);
    await this.page.waitForLoadState('domcontentloaded');
  }

  get appTitle() {
    return this.page.getByText('Flight Tracker');
  }

  tabButton(tab: AppTab) {
    return this.page.locator('nav').getByRole('button', { name: TAB_LABELS[tab] });
  }
}
