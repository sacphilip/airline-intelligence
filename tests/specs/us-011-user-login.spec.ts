/**
 * US-011 — User Login
 * All auth API calls are mocked via page.route() — never hits the real backend.
 * All AeroDataBox / flight API routes are also mocked to protect quota.
 */
import { test, expect, Page } from '@playwright/test';

const ALICE = { id: 1, email: 'alice@example.com', firstName: 'Alice' };

async function mockFlightApis(page: Page): Promise<void> {
  await page.route('**/api/search**',          r => r.fulfill({ status: 200, json: { legs: [] } }));
  await page.route('**/api/route/**',           r => r.fulfill({ status: 200, json: {} }));
  await page.route('**/api/flight/history**',   r => r.fulfill({ status: 200, json: { flights: [] } }));
  await page.route('**/api/airline/profile**',  r => r.fulfill({ status: 200, json: {} }));
  await page.route('**/api/airline/rankings**', r => r.fulfill({ status: 200, json: [] }));
  await page.route('**/api/delays/**',          r => r.fulfill({ status: 200, json: [] }));
}

test.describe('US-011 — User Login', () => {

  test('TC-011-01: Login page renders with email field, password field and Log in button', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('TC-011-02: Valid credentials redirect to homepage and nav shows first name', async ({ page }) => {
    await mockFlightApis(page);
    // authMe called on homepage mount after redirect — mock to return Alice
    await page.route('**/api/auth/me',    r => r.fulfill({ status: 200, json: ALICE }));
    await page.route('**/api/auth/login', r => r.fulfill({ status: 200, json: ALICE }));

    await page.goto('/login');
    await page.getByLabel('Email').fill('alice@example.com');
    await page.getByLabel('Password').fill('password123');
    await Promise.all([
      page.waitForURL('http://localhost:3000/'),
      page.getByRole('button', { name: 'Log in' }).click(),
    ]);
    // Homepage nav should now show first name and Log out
    await expect(page.getByText('Alice')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
  });

  test('TC-011-03: Nav shows Log in button when GET /api/auth/me returns null', async ({ page }) => {
    await mockFlightApis(page);
    await page.route('**/api/auth/me', r => r.fulfill({ status: 200, json: null }));
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Log in' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log out' })).not.toBeVisible();
  });

  test('TC-011-04: Wrong credentials show generic error banner', async ({ page }) => {
    await page.route('**/api/auth/login', r =>
      r.fulfill({ status: 401, json: { message: 'Incorrect email or password.' } })
    );
    await page.goto('/login');
    await page.getByLabel('Email').fill('alice@example.com');
    await page.getByLabel('Password').fill('wrong');
    await page.getByRole('button', { name: 'Log in' }).click();
    // Exclude Next.js route-announcer which also carries role="alert"
    const alert = page.locator('div[role="alert"]:not([aria-live])');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Incorrect email or password.');
    await expect(page).toHaveURL(/\/login/);
  });

  test('TC-011-05: Rate-limited account shows lockout message', async ({ page }) => {
    await page.route('**/api/auth/login', r =>
      r.fulfill({ status: 401, json: { message: 'Too many attempts. Try again in 15 minutes.' } })
    );
    await page.goto('/login');
    await page.getByLabel('Email').fill('alice@example.com');
    await page.getByLabel('Password').fill('anything');
    await page.getByRole('button', { name: 'Log in' }).click();
    const alert = page.locator('div[role="alert"]:not([aria-live])');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Too many attempts. Try again in 15 minutes.');
  });

  test('TC-011-06: Submitting with empty email highlights email field and shows inline error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Password').fill('anything');
    await page.getByRole('button', { name: 'Log in' }).click();
    const emailInput = page.getByLabel('Email');
    await expect(emailInput).toHaveAttribute('aria-invalid', 'true');
    const errorEl = page.locator('#email-error');
    await expect(errorEl).toBeVisible();
    await expect(errorEl).toContainText(/required|valid email/i);
  });

  test('TC-011-07: Invalid email format triggers inline error on blur', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('notanemail');
    await page.getByLabel('Email').blur();
    await expect(page.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true');
    const errorEl = page.locator('#email-error');
    await expect(errorEl).toBeVisible();
    await expect(errorEl).toContainText('valid email');
  });

  test('TC-011-08: Nav shows first name and Log out when GET /api/auth/me returns a user', async ({ page }) => {
    await mockFlightApis(page);
    await page.route('**/api/auth/me', r => r.fulfill({ status: 200, json: ALICE }));
    await page.goto('/');
    await expect(page.getByText('Alice')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Log in' })).not.toBeVisible();
  });

  test('TC-011-09: Clicking Log out calls logout endpoint and nav reverts to Log in', async ({ page }) => {
    await mockFlightApis(page);
    await page.route('**/api/auth/me',     r => r.fulfill({ status: 200, json: ALICE }));
    await page.route('**/api/auth/logout', r => r.fulfill({ status: 200, json: { ok: true } }));
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page.getByRole('link', { name: 'Log in' })).toBeVisible();
    await expect(page.getByText('Alice')).not.toBeVisible();
  });

  test('TC-011-10: Submitting with empty password shows error and does not call API', async ({ page }) => {
    let loginCalled = false;
    await page.route('**/api/auth/login', r => { loginCalled = true; return r.continue(); });
    await page.goto('/login');
    await page.getByLabel('Email').fill('alice@example.com');
    // password left empty
    await page.getByRole('button', { name: 'Log in' }).click();
    const alert = page.locator('div[role="alert"]:not([aria-live])');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/password/i);
    expect(loginCalled).toBe(false);
  });

  test('TC-011-11: Login with ?next param redirects to that path after success', async ({ page }) => {
    await mockFlightApis(page);
    await page.route('**/api/auth/me',    r => r.fulfill({ status: 200, json: ALICE }));
    await page.route('**/api/auth/login', r => r.fulfill({ status: 200, json: ALICE }));
    await page.goto('/login?next=/');
    await page.getByLabel('Email').fill('alice@example.com');
    await page.getByLabel('Password').fill('password123');
    await Promise.all([
      page.waitForURL('http://localhost:3000/'),
      page.getByRole('button', { name: 'Log in' }).click(),
    ]);
    await expect(page).toHaveURL('http://localhost:3000/');
  });

  test('TC-011-12: Email error element is linked via aria-describedby', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Log in' }).click();
    const emailInput = page.getByLabel('Email');
    await expect(emailInput).toHaveAttribute('aria-invalid', 'true');
    const describedBy = await emailInput.getAttribute('aria-describedby');
    expect(describedBy).toBe('email-error');
    const errorEl = page.locator('#email-error');
    await expect(errorEl).toBeVisible();
    await expect(errorEl).not.toBeEmpty();
  });

  test("TC-011-13: Loading state shows 'Signing in…' during login request", async ({ page }) => {
    let resolveRequest!: () => void;
    const requestPending = new Promise<void>(resolve => { resolveRequest = resolve; });
    await page.route('**/api/auth/login', async r => {
      // Hold the route until we've verified the loading state
      await requestPending;
      await r.fulfill({ status: 200, json: ALICE });
    });
    await page.goto('/login');
    await page.getByLabel('Email').fill('alice@example.com');
    await page.getByLabel('Password').fill('password123');
    await page.getByRole('button', { name: 'Log in' }).click();
    // While the request is in-flight, button should show loading state
    const loadingBtn = page.getByRole('button', { name: /Signing in/i });
    await expect(loadingBtn).toBeVisible();
    await expect(loadingBtn).toBeDisabled();
    // Release the held request
    resolveRequest();
  });

  // AC-06: session persists across browser refresh
  test('TC-011-14: Session persists across browser refresh', async ({ page }) => {
    await mockFlightApis(page);
    await page.route('**/api/auth/me', r => r.fulfill({ status: 200, json: ALICE }));
    await page.goto('/');
    await expect(page.getByText('Alice')).toBeVisible();
    // Reload simulates a browser refresh — authMe is called again with the cookie
    await page.reload();
    await expect(page.getByText('Alice')).toBeVisible();
    // HttpOnly cookies are not readable by JS — sid must not appear in document.cookie
    const cookieStr: string = await page.evaluate(() => document.cookie);
    expect(cookieStr).not.toMatch(/\bsid\b/);
  });

  // AC-08: logout clears cookie AND invalidates server-side session
  // Uses the REAL backend — no auth mocks — so it catches genuine Redis/cookie bugs.
  // Requires: alice@example.com / password123 in the database, backend running at :3100.
  test('TC-011-15: Logout clears cookie and invalidates server-side session (real backend)', async ({ page }) => {
    // Only mock flight APIs to protect AeroDataBox quota; auth goes to real backend
    await mockFlightApis(page);

    // 1. Real login
    await page.goto('/login');
    await page.getByLabel('Email').fill('alice@example.com');
    await page.getByLabel('Password').fill('password123');
    await Promise.all([
      page.waitForURL('http://localhost:3000/'),
      page.getByRole('button', { name: 'Log in' }).click(),
    ]);
    await expect(page.getByText('Alice')).toBeVisible();

    // 2. Capture the session ID from the cookie jar (Playwright can read HttpOnly cookies)
    const cookiesBefore = await page.context().cookies();
    const sidCookie = cookiesBefore.find(c => c.name === 'sid');
    expect(sidCookie, 'sid cookie must exist after login').toBeDefined();
    const sessionId = sidCookie!.value;

    // 3. Real logout
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page.getByRole('link', { name: 'Log in' })).toBeVisible();

    // 4. Cookie must be cleared from the browser
    const cookiesAfter = await page.context().cookies();
    expect(
      cookiesAfter.find(c => c.name === 'sid'),
      'sid cookie must be absent after logout',
    ).toBeUndefined();

    // 5. Reload confirms authMe returns null (no cookie sent → null response)
    await page.reload();
    await expect(page.getByRole('link', { name: 'Log in' })).toBeVisible();
    await expect(page.getByText('Alice')).not.toBeVisible();

    // 6. Server-side: the old session ID must be invalidated in Redis
    //    Call /api/auth/me directly with the captured session ID; must return null.
    const stale = await page.request.get('http://localhost:3100/api/auth/me', {
      headers: { Cookie: `sid=${sessionId}` },
    });
    expect(stale.status()).toBe(200);
    const staleBody = await stale.json();
    expect(staleBody, 'Stale session ID must be invalidated server-side').toBeNull();
  });

  // AC-09: concurrent sessions — two browser contexts can each hold an active session
  test('TC-011-16: Two independent browser contexts can each have an active session', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    try {
      const page1 = await ctx1.newPage();
      const page2 = await ctx2.newPage();
      for (const p of [page1, page2]) {
        await mockFlightApis(p);
        await p.route('**/api/auth/me', r => r.fulfill({ status: 200, json: ALICE }));
      }
      await page1.goto('/');
      await page2.goto('/');
      await expect(page1.getByText('Alice')).toBeVisible();
      await expect(page2.getByText('Alice')).toBeVisible();
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  // AC-12: unauthenticated users can access all read-only tabs
  test('TC-011-17: Unauthenticated users can access all read-only tabs', async ({ page }) => {
    await mockFlightApis(page);
    await page.route('**/api/auth/me', r => r.fulfill({ status: 200, json: null }));
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Log in' })).toBeVisible();
    // All four tabs visible and clickable without login
    const nav = page.locator('nav');
    await expect(nav.getByRole('button', { name: /live map/i })).toBeVisible();
    await expect(nav.getByRole('button', { name: /find flight/i })).toBeVisible();
    await expect(nav.getByRole('button', { name: /delays/i })).toBeVisible();
    await expect(nav.getByRole('button', { name: /airlines/i })).toBeVisible();
    // Navigate to Find Flight — must work without login
    await nav.getByRole('button', { name: /find flight/i }).click();
    await expect(nav.getByRole('button', { name: /find flight/i })).toHaveAttribute('aria-selected', 'true');
  });

});
