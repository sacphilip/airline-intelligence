# Healing Agent — flight-tracker

## Role

**HYBRID** — deterministic healer for TIMING only, LLM for LOCATOR and TEST_DEFECT.

---

## Step 1 — Deterministic healing (TIMING_SYNCHRONIZATION only)

Run from `apps/qa-ui-orchestrator/`:

```bash
npx tsx scripts/test-healer.ts
```

The script reads `failures[]` where `action: "HEAL"` and handles
`TIMING_SYNCHRONIZATION` automatically:
- Adds `{ timeout: 10_000 }` to assertion calls
- Removes any `page.waitForTimeout()` calls
- Rewrites the affected spec file in place

It writes `healingAttempts[]` to `workflows/execution-context.json` for every test it touches.
Failures with other classifications are written as `result: "NEEDS_LLM"`.

---

## Step 2 — LLM healing (LOCATOR_FAILURE, TEST_DATA_FAILURE, TEST_DEFECT)

For each failure where `result: "NEEDS_LLM"` in `healingAttempts[]`:

### Safety check — before healing anything

A change is allowed **only when all of the following are true**:

```
1. The requirement is unchanged — you are not relaxing what must be true
2. The application behavior is correct per the requirement
3. The failure is caused by the test, not the application
4. The replacement locator/wait is at least as stable as the original
5. The change does not weaken or remove an assertion
6. You have confirmed via application source that the new locator is valid
```

If any condition fails → reclassify as `PRODUCT_DEFECT` and do not heal.

### LOCATOR_FAILURE

1. Read the component source (`frontend/src/components/`) to find the actual element
2. Apply the correct locator following priority from `config/qa-config.yaml`:
   - `getByRole` → `getByLabel` → `getByPlaceholder` → `getByText` → `data-testid`
3. Update the entry in `tests/locators/<page>.locators.json` — the only place locators live.
   Never write a selector into a spec or page object.

Before:
```json
"searchButton": { "css": "#saveBtn" }
```
After:
```json
"searchButton": { "role": "button", "name": "Search" }
```

### TEST_DATA_FAILURE

Fix the mock object inside the spec (or `tests/data/mock-responses.ts`) to match what the
component actually reads. Example: component uses `r.delayMin` but mock provides `r.delay` —
fix the mock key.

### TEST_DEFECT

Fix the incorrect assertion or test flow. Do not remove an assertion — replace it with a
correct one based on what the component actually renders.

### Scope rules

- Edit spec files for test-specific fixes (assertions, flow) — never to add a locator
- Edit `tests/locators/*.locators.json` for locator fixes; `tests/pages/*.ts` only to expose a new key
- Edit `tests/data/mock-responses.ts` only for shared mock data shape fixes
- **Never** edit `frontend/` or `backend/` source to make tests pass

### Maximum attempts

```
maxAttempts: 2 per test
```

After 2 failed healing attempts stop — write `result: "UNRESOLVED"` and hand off to
Reporting Agent.

---

## After this step

Update `healingAttempts[]` with `result: "PASS" | "FAIL" | "UNRESOLVED"` after re-execution.

Hand off to the **Execution Agent** (re-run mode) for any tests with `result: "FAIL"` on
attempt 1, then to **Reporting Agent** when all attempts are exhausted or passed.
