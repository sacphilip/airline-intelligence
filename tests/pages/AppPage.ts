import { Page, expect } from '@playwright/test';
import { Locators } from '../support/locators';
import appLocators from '../locators/app.locators.json';

export type AppTab = 'map' | 'flight' | 'delays' | 'airline';

const TAB_KEYS = { map: 'tabMap', flight: 'tabFlight', delays: 'tabDelays', airline: 'tabAirline' } as const;

export class AppPage {
  private readonly loc: Locators<keyof typeof appLocators>;

  constructor(readonly page: Page) {
    this.loc = new Locators(page, appLocators, 'app.locators.json');
  }

  async goto() {
    await this.page.goto('/');
    await this.page.waitForLoadState('domcontentloaded');
  }

  async gotoViaHash(hash: string) {
    await this.page.goto(`/#${hash}`);
    await this.page.waitForLoadState('domcontentloaded');
  }

  tabButton(tab: AppTab) {
    return this.loc.get(TAB_KEYS[tab]);
  }

  async navigateTo(tab: AppTab) {
    await this.tabButton(tab).click();
  }

  async expectActiveTab(tab: AppTab) {
    await expect(this.tabButton(tab)).toHaveAttribute('aria-selected', 'true');
  }

  get body()         { return this.loc.get('body'); }
  get appTitle()     { return this.loc.get('appTitle'); }
  get themeToggle()  { return this.loc.get('themeToggle'); }
  get logInLink()    { return this.loc.get('logInLink'); }
  get logOutButton() { return this.loc.get('logOutButton'); }

  userName(name: string) {
    return this.loc.get('userName', { name });
  }
}
