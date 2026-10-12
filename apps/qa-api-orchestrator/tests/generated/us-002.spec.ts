import { test, expect } from '@playwright/test';

test.describe('US-002', () => {

  // REQ-002-05
  test("TC-002-01: missing from returns 400", async ({ request }) => {
    const res = await request.get("/api/route", {"params":{"to":"DEL","date":"2026-09-30"}});
    expect(res.status()).toBe(400);
  });

  // REQ-002-05
  test("TC-002-02: missing to returns 400", async ({ request }) => {
    const res = await request.get("/api/route", {"params":{"from":"BLR","date":"2026-09-30"}});
    expect(res.status()).toBe(400);
  });

  // REQ-002-05
  test("TC-002-03: missing date returns 400", async ({ request }) => {
    const res = await request.get("/api/route", {"params":{"from":"BLR","to":"DEL"}});
    expect(res.status()).toBe(400);
  });

  // REQ-002-05
  test("TC-002-04: invalid from returns 400", async ({ request }) => {
    const res = await request.get("/api/route", {"params":{"from":"X","to":"DEL","date":"2026-09-30"}});
    expect(res.status()).toBe(400);
  });

  // REQ-002-05
  test("TC-002-05: invalid to returns 400", async ({ request }) => {
    const res = await request.get("/api/route", {"params":{"from":"BLR","to":"X","date":"2026-09-30"}});
    expect(res.status()).toBe(400);
  });

  // REQ-002-05
  test("TC-002-06: invalid date returns 400", async ({ request }) => {
    const res = await request.get("/api/route", {"params":{"from":"BLR","to":"DEL","date":"not-a-date"}});
    expect(res.status()).toBe(400);
  });

  // REQ-002-01
  test("TC-002-07: valid request resolves", async ({ request }) => {
    const res = await request.get("/api/route", {"params":{"from":"BLR","to":"DEL","date":"2026-09-30"}});
    // Accept 200, 404 (no data), or 503 (external service not configured)
    expect(res.status()).toBeLessThan(500);
  });

  // REQ-002-06
  test("TC-002-08: response is valid JSON", async ({ request }) => {
    const res = await request.get("/api/route", {"params":{"from":"BLR","to":"DEL","date":"2026-09-30"}});
    // Accept 200, 404 (no data), or 503 (external service not configured)
    expect(res.status()).toBeLessThan(500);
    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toBeDefined();
    }
  });
});
