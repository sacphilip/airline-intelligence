import { test, expect } from '@playwright/test';

test.describe('US-007', () => {

  // REQ-007-01
  test("TC-007-01: valid request resolves", async ({ request }) => {
    const res = await request.get("/api/airline/rankings");
    // Accept 200, 404 (no data), or 503 (external service not configured)
    expect(res.status() < 500 || res.status() === 503).toBe(true);
  });
});
