import { Page } from '@playwright/test';
import { Locators } from '../support/locators';
import analyticsLocators from '../locators/route-analytics.locators.json';

/** The route analytics panel shown under a route search (US-009). */
export class RouteAnalyticsPanel {
  private readonly loc: Locators<keyof typeof analyticsLocators>;

  constructor(readonly page: Page) {
    this.loc = new Locators(page, analyticsLocators, 'route-analytics.locators.json');
  }

  get panel()         { return this.loc.get('panel'); }
  get route()         { return this.loc.get('route'); }
  get since()         { return this.loc.get('since'); }
  get empty()         { return this.loc.get('empty'); }
  get flights()       { return this.loc.get('flights'); }
  get avgDelay()      { return this.loc.get('avgDelay'); }
  get onTime()        { return this.loc.get('onTime'); }
  get cancellation()  { return this.loc.get('cancellation'); }
  get airlinesTable() { return this.loc.get('airlinesTable'); }
  get insufficient()  { return this.loc.get('insufficient'); }
  get airlineRows()   { return this.loc.get('airlineRows'); }

  airlineRow(iata: string) {
    return this.loc.get('airlineRow', { iata });
  }

  /** Columns: 0 airline, 1 flights, 2 on-time, 3 avg delay, 4 cancellation, 5 score. */
  airlineCell(iata: string, col: number) {
    return this.loc.get('airlineCell', { iata, col });
  }

  sortHeader(column: string) {
    return this.loc.get('sortHeader', { column });
  }

  /** IATA codes of the ranked rows, top to bottom. */
  async rankedIatas(): Promise<string[]> {
    return this.airlineRows.evaluateAll((rows) =>
      rows.map((r) => r.getAttribute('data-testid')!.replace('route-airline-', '')),
    );
  }
}
