import { Page } from '@playwright/test';
import { Locators } from '../support/locators';
import loginLocators from '../locators/login.locators.json';

export class LoginPage {
  private readonly loc: Locators<keyof typeof loginLocators>;

  constructor(readonly page: Page) {
    this.loc = new Locators(page, loginLocators, 'login.locators.json');
  }

  async goto(next?: string) {
    await this.page.goto(next ? `/login?next=${next}` : '/login');
  }

  get heading()         { return this.loc.get('heading'); }
  get emailInput()      { return this.loc.get('emailInput'); }
  get passwordInput()   { return this.loc.get('passwordInput'); }
  get submitButton()    { return this.loc.get('submitButton'); }
  get signingInButton() { return this.loc.get('signingInButton'); }
  get emailError()      { return this.loc.get('emailError'); }

  /** The form's error banner (Next.js's route announcer also has role="alert", so it is excluded). */
  get formAlert()       { return this.loc.get('formAlert'); }

  async fill(email: string, password?: string) {
    await this.emailInput.fill(email);
    if (password !== undefined) await this.passwordInput.fill(password);
  }
}
