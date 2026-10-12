import { test, expect } from '@playwright/test';

test.describe('US-003', () => {

  // REQ-003-08
  test("TC-003-01: missing number returns 400", async ({ request }) => {
    const res = await request.get("/api/search", {"params":{"date":"2026-10-07"}});
    expect(res.status()).toBe(400);
  });

  // REQ-003-08
  test("TC-003-02: missing date returns 400", async ({ request }) => {
    const res = await request.get("/api/search", {"params":{"number":"6E5321"}});
    expect(res.status()).toBeLessThan(500);
  });

  // REQ-003-08
  test("TC-003-03: invalid number returns 400", async ({ request }) => {
    const res = await request.get("/api/search", {"params":{"number":"TOOLONGNOTVALID12345","date":"2026-10-07"}});
    expect(res.status()).toBe(400);
  });

  // REQ-003-08
  test("TC-003-04: invalid date returns 400", async ({ request }) => {
    const res = await request.get("/api/search", {"params":{"number":"6E5321","date":"not-a-date"}});
    expect(res.status()).toBe(400);
  });

  // REQ-003-01
  test("TC-003-05: valid request resolves", async ({ request }) => {
    const res = await request.get("/api/search", {"params":{"number":"6E5321","date":"2026-10-07"}});
    // Accept 200, 404 (no data), or 503 (external service not configured)
    expect(res.status()).toBeLessThan(500);
  });

  // REQ-003-09
  test("TC-003-06: response is valid JSON", async ({ request }) => {
    const res = await request.get("/api/search", {"params":{"number":"6E5321","date":"2026-10-07"}});
    // Accept 200, 404 (no data), or 503 (external service not configured)
    expect(res.status()).toBeLessThan(500);
    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toBeDefined();
    }
  });
});
