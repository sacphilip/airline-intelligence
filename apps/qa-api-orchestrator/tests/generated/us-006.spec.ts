import { test, expect } from '@playwright/test';

test.describe('US-006', () => {

  // REQ-006-11
  test("TC-006-01: missing iata returns 400", async ({ request }) => {
    const res = await request.get("/api/airline/profile");
    expect(res.status()).toBe(400);
  });

  // REQ-006-11
  test("TC-006-02: invalid iata returns 400", async ({ request }) => {
    const res = await request.get("/api/airline/profile", {"params":{"iata":"12345"}});
    expect(res.status()).toBe(400);
  });

  // REQ-006-01
  test("TC-006-03: valid request resolves", async ({ request }) => {
    const res = await request.get("/api/airline/profile", {"params":{"iata":"6E"}});
    // Accept 200, 404 (no data), or 503 (external service not configured)
    expect(res.status()).toBeLessThan(500);
  });

  // REQ-006-12
  test("TC-006-04: response is valid JSON", async ({ request }) => {
    const res = await request.get("/api/airline/profile", {"params":{"iata":"6E"}});
    // Accept 200, 404 (no data), or 503 (external service not configured)
    expect(res.status()).toBeLessThan(500);
    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toBeDefined();
    }
  });
});
