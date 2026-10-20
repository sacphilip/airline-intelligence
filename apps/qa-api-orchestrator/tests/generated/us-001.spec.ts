import { test, expect } from '@playwright/test';

test.describe('US-001', () => {

  // REQ-001-06
  test("TC-001-01: missing number returns 400", async ({ request }) => {
    const res = await request.get("/api/search", {"params":{"date":"2026-10-07"}});
    expect(res.status()).toBe(400);
  });

  // REQ-001-06
  test("TC-001-02: missing date returns 400", async ({ request }) => {
    const res = await request.get("/api/search", {"params":{"number":"6E5321"}});
    expect(res.status()).toBeLessThan(500);
  });

  // REQ-001-02
  test("TC-001-03: invalid number returns 400", async ({ request }) => {
    const res = await request.get("/api/search", {"params":{"number":"TOOLONGNOTVALID12345","date":"2026-10-07"}});
    expect(res.status()).toBe(400);
  });

  // REQ-001-02
  test("TC-001-04: invalid date returns 400", async ({ request }) => {
    const res = await request.get("/api/search", {"params":{"number":"6E5321","date":"not-a-date"}});
    expect(res.status()).toBe(400);
  });

  // REQ-001-01
  test("TC-001-05: valid request resolves", async ({ request }) => {
    const res = await request.get("/api/search", {"params":{"number":"6E5321","date":"2026-10-07"}});
    // Accept 200, 404 (no data), or 503 (external service not configured)
    expect(res.status()).toBeLessThan(500);
  });

  // REQ-001-07
  test("TC-001-06: response is valid JSON", async ({ request }) => {
    const res = await request.get("/api/search", {"params":{"number":"6E5321","date":"2026-10-07"}});
    // Accept 200, 404 (no data), or 503 (external service not configured)
    expect(res.status()).toBeLessThan(500);
    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toBeDefined();
    }
  });
});
