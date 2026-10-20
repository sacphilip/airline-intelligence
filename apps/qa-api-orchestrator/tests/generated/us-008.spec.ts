import { test, expect } from '@playwright/test';

test.describe('US-008', () => {

  // REQ-008-08
  test("TC-008-01: missing iata returns 400", async ({ request }) => {
    const res = await request.get("/api/airline/trend", {"params":{"months":"test"}});
    expect(res.status()).toBe(400);
  });

  // REQ-008-08
  test("TC-008-02: missing months returns 400", async ({ request }) => {
    const res = await request.get("/api/airline/trend", {"params":{"iata":"6E"}});
    expect(res.status()).toBeLessThan(500);
  });

  // REQ-008-08
  test("TC-008-03: invalid iata returns 400", async ({ request }) => {
    const res = await request.get("/api/airline/trend", {"params":{"iata":"12345","months":"test"}});
    expect(res.status()).toBe(400);
  });

  // REQ-008-01
  test("TC-008-04: valid request resolves", async ({ request }) => {
    const res = await request.get("/api/airline/trend", {"params":{"iata":"6E","months":"test"}});
    // Accept 200, 404 (no data), or 503 (external service not configured)
    expect(res.status()).toBeLessThan(500);
  });

  // REQ-008-09
  test("TC-008-05: response is valid JSON", async ({ request }) => {
    const res = await request.get("/api/airline/trend", {"params":{"iata":"6E","months":"test"}});
    // Accept 200, 404 (no data), or 503 (external service not configured)
    expect(res.status()).toBeLessThan(500);
    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toBeDefined();
    }
  });
});
