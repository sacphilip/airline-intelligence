# Failure Analysis Agent — flight-tracker

## Role

**HYBRID** — deterministic pattern classification first, LLM screenshot inspection only for UNKNOWN failures.

---

## Step 1 — Pattern classification (deterministic)

Run from `apps/qa-ui-orchestrator/`:

```bash
npx tsx scripts/failure-analyzer.ts
```

The script reads `executionResults[]` filtered to `result: "FAIL"` and runs 9 regex patterns
against each error message to classify:

| Code | Action |
|---|---|
| `LOCATOR_FAILURE` | `HEAL` |
| `TIMING_SYNCHRONIZATION` | `HEAL` |
| `TEST_DATA_FAILURE` | `HEAL` |
| `TEST_DEFECT` | `HEAL` |
| `PRODUCT_DEFECT` | `REPORT_DEFECT` |
| `ENVIRONMENT_FAILURE` | `INVESTIGATE` |
| `NETWORK_API_FAILURE` | `INVESTIGATE` |
| `UNKNOWN` | flagged for Step 2 |

It writes `failures[]` to `workflows/execution-context.json`. Any failure it cannot classify is written
with `classification: "UNKNOWN"` and `action: "INVESTIGATE"`.

---

## Step 2 — Screenshot inspection (LLM — only for UNKNOWN failures)

If any failure has `classification: "UNKNOWN"`, inspect it manually:

1. Read the assertion error message from `executionResults[]`
2. Open the screenshot from `test-results/` if one exists
3. Open the Playwright trace if a `.zip` trace exists
4. Read the test source and the relevant component source
5. Apply the classification taxonomy:

| Code | Meaning |
|---|---|
| `PRODUCT_DEFECT` | Application does not behave as the requirement specifies |
| `TEST_DEFECT` | Test logic is incorrect (wrong assertion, wrong flow) |
| `LOCATOR_FAILURE` | Element exists but locator doesn't find it |
| `TIMING_SYNCHRONIZATION` | Element exists but test acted too early |
| `TEST_DATA_FAILURE` | Mock data doesn't match what the component expects |
| `ENVIRONMENT_FAILURE` | Server not running, dependency missing, port conflict |
| `NETWORK_API_FAILURE` | Unmocked API call failing or unexpected response |

### Decision order

```
1. Does the application render incorrectly per the requirement?
   YES → PRODUCT_DEFECT (do not heal)

2. Does the locator find nothing, but element is visible in screenshot?
   YES → LOCATOR_FAILURE (healable)

3. Did an assertion fire before the page finished loading?
   YES → TIMING_SYNCHRONIZATION (healable)

4. Does mock data not match what the component reads?
   YES → TEST_DATA_FAILURE (healable)

5. Is the server returning an unexpected response?
   YES → NETWORK_API_FAILURE (investigate)

6. Is the test assertion itself wrong?
   YES → TEST_DEFECT (healable)
```

6. Update the UNKNOWN entries in `failures[]` with the correct classification and action.

### Critical rule

If the requirement says the application should behave one way, and the application behaves
differently, that is a **PRODUCT_DEFECT**. Do not change the test expectation to match broken
behavior. When in doubt, prefer `PRODUCT_DEFECT` over healing.

---

## After this step

Hand off to:
- **Healing Agent** if any failure has `action: "HEAL"`
- **Reporting Agent** if all failures are `PRODUCT_DEFECT` or `INVESTIGATE`
