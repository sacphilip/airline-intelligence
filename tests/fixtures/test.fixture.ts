import { test as base, expect } from '@playwright/test';
import { AppPage } from '../pages/AppPage';
import { FlightSearchPage } from '../pages/FlightSearchPage';
import { AirlinePage } from '../pages/AirlinePage';

type Fixtures = {
  app: AppPage;
  flightSearch: FlightSearchPage;
  airlinePage: AirlinePage;
};

export const test = base.extend<Fixtures>({
  app: async ({ page }, use) => {
    const app = new AppPage(page);
    await app.goto();
    await use(app);
  },

  flightSearch: async ({ page, app }, use) => {
    await app.navigateTo('flight');
    await use(new FlightSearchPage(page));
  },

  airlinePage: async ({ page, app }, use) => {
    await app.navigateTo('airline');
    await use(new AirlinePage(page));
  },
});

export { expect };
