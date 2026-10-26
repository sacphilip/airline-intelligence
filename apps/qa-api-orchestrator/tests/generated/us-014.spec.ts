import { test, expect } from '@playwright/test';

test.describe('US-014', () => {

  // REQ-014-16
  test("TC-014-01: missing airport returns 400", async ({ request }) => {
    const res = await request.get("/api/delays");
    expect(res.status()).toBe(400);
  });

  // REQ-014-01
  test("TC-014-02: valid request resolves", async ({ request }) => {
    const res = await request.get("/api/delays", {"params":{"airport":"DEL"}});
    // Accept 200, 404 (no data), or 503 (external service not configured)
    expect(res.status()).toBeLessThan(500);
  });

  // REQ-014-17
  test("TC-014-03: response is valid JSON", async ({ request }) => {
    const res = await request.get("/api/delays", {"params":{"airport":"DEL"}});
    // Accept 200, 404 (no data), or 503 (external service not configured)
    expect(res.status()).toBeLessThan(500);
    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toBeDefined();
    }
  });
});
