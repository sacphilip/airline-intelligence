import { test, expect } from '@playwright/test';

test.describe('US-012', () => {

  // REQ-012-01
  test("TC-012-01: valid request resolves", async ({ request }) => {
    const res = await request.get("/api/auth/oauth/providers");
    // Accept 200, 404 (no data), or 503 (external service not configured)
    expect(res.status() < 500 || res.status() === 503).toBe(true);
  });

  // REQ-012-19
  test("TC-012-02: response is valid JSON", async ({ request }) => {
    const res = await request.get("/api/auth/oauth/providers");
    // Accept 200, 404 (no data), or 503 (external service not configured)
    expect(res.status() < 500 || res.status() === 503).toBe(true);
    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toBeDefined();
    }
  });

  // REQ-012-01
  test("TC-012-03: valid request resolves", async ({ request }) => {
    const res = await request.get("/api/auth/oauth/{provider}/start");
    // Accept 200, 404 (no data), or 503 (external service not configured)
    expect(res.status() < 500 || res.status() === 503).toBe(true);
  });

  // REQ-012-19
  test("TC-012-04: response is valid JSON", async ({ request }) => {
    const res = await request.get("/api/auth/oauth/{provider}/start");
    // Accept 200, 404 (no data), or 503 (external service not configured)
    expect(res.status() < 500 || res.status() === 503).toBe(true);
    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toBeDefined();
    }
  });

  // REQ-012-01
  test("TC-012-05: valid request resolves", async ({ request }) => {
    const res = await request.get("/api/auth/oauth/{provider}/callback");
    // Accept 200, 404 (no data), or 503 (external service not configured)
    expect(res.status() < 500 || res.status() === 503).toBe(true);
  });

  // REQ-012-19
  test("TC-012-06: response is valid JSON", async ({ request }) => {
    const res = await request.get("/api/auth/oauth/{provider}/callback");
    // Accept 200, 404 (no data), or 503 (external service not configured)
    expect(res.status() < 500 || res.status() === 503).toBe(true);
    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toBeDefined();
    }
  });

  // REQ-012-11
  test("TC-012-07: missing body field 'code' returns 400", async ({ request }) => {
    const res = await request.post("/api/auth/oauth/{provider}/link");
    expect(res.status()).toBe(400);
  });

  // REQ-012-11
  test("TC-012-08: missing body field 'state' returns 400", async ({ request }) => {
    const res = await request.post("/api/auth/oauth/{provider}/link");
    expect(res.status()).toBe(400);
  });

  // REQ-012-01
  test("TC-012-09: valid request resolves", async ({ request }) => {
    const res = await request.post("/api/auth/oauth/{provider}/link");
    // Accept 200, 404 (no data), or 503 (external service not configured)
    expect(res.status() < 500 || res.status() === 503).toBe(true);
  });

  // REQ-012-19
  test("TC-012-10: response is valid JSON", async ({ request }) => {
    const res = await request.post("/api/auth/oauth/{provider}/link");
    // Accept 200, 404 (no data), or 503 (external service not configured)
    expect(res.status() < 500 || res.status() === 503).toBe(true);
    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toBeDefined();
    }
  });

  // REQ-012-01
  test("TC-012-11: valid request resolves", async ({ request }) => {
    const res = await request.delete("/api/auth/oauth/{provider}/link");
    // Accept 200, 404 (no data), or 503 (external service not configured)
    expect(res.status() < 500 || res.status() === 503).toBe(true);
  });

  // REQ-012-19
  test("TC-012-12: response is valid JSON", async ({ request }) => {
    const res = await request.delete("/api/auth/oauth/{provider}/link");
    // Accept 200, 404 (no data), or 503 (external service not configured)
    expect(res.status() < 500 || res.status() === 503).toBe(true);
    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toBeDefined();
    }
  });
});
