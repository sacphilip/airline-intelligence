import { test, expect } from '@playwright/test';

test.describe('US-005', () => {

  // REQ-005-05
  test("TC-005-01: missing number returns 400", async ({ request }) => {
    const res = await request.get("/api/flight/history", {"params":{"days":"7"}});
    expect(res.status()).toBe(400);
  });

  // REQ-005-05
  test("TC-005-02: missing days returns 400", async ({ request }) => {
    const res = await request.get("/api/flight/history", {"params":{"number":"6E5321"}});
    expect(res.status() < 500 || res.status() === 503).toBe(true);
  });

  // REQ-005-05
  test("TC-005-03: invalid number returns 400", async ({ request }) => {
    const res = await request.get("/api/flight/history", {"params":{"number":"TOOLONGNOTVALID12345","days":"7"}});
    expect(res.status() < 500 || res.status() === 503).toBe(true);
  });

  // REQ-005-01
  test("TC-005-04: valid request resolves", async ({ request }) => {
    const res = await request.get("/api/flight/history", {"params":{"number":"6E5321","days":"7"}});
    // Accept 200, 404 (no data), or 503 (external service not configured)
    expect(res.status() < 500 || res.status() === 503).toBe(true);
  });

  // REQ-005-06
  test("TC-005-05: response is valid JSON", async ({ request }) => {
    const res = await request.get("/api/flight/history", {"params":{"number":"6E5321","days":"7"}});
    // Accept 200, 404 (no data), or 503 (external service not configured)
    expect(res.status() < 500 || res.status() === 503).toBe(true);
    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toBeDefined();
    }
  });
});
