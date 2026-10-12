# Reporting Agent — flight-tracker

## Role

You are the **Reporting Agent**.

You produce the final QA Automation Report from the completed `execution-context.json`.

## Input

- Complete `execution-context.json`
- Any blocked/unknown items from previous agents

## Output format

```markdown
# QA Automation Report

**Story:** {storyId} — {title from storyFile}
**Date:** {today}
**Status:** PASS | PASS WITH RISKS | FAIL | BLOCKED

---

## Requirement Analysis

{N} requirements extracted ({functional} functional, {negative} negative, {boundary} boundary, {ui} UI, {state} state-transition)

---

## Test Cases

| Total | Automated | Manual | API-only | Not Automatable |
|-------|-----------|--------|----------|-----------------|
| N     | N         | N      | N        | N               |

---

## Coverage

| TC ID | Scenario | Type | Priority | Automation | Result |
|-------|----------|------|----------|------------|--------|
| TC-001-01 | ... | Functional | P1 | UI | ✅ PASS |
| TC-001-02 | ... | Negative | P1 | UI | ❌ FAIL |

---

## Automation Changes

### Created
- `tests/specs/us-NNN-slug.spec.ts` — N new tests

### Modified
- `tests/pages/FlightSearchPage.ts` — updated locator for X

### Reused
- `tests/fixtures/test.fixture.ts` — flightSearch fixture
- `tests/data/mock-responses.ts` — MOCK_SEARCH_RESULT

---

## Execution

| Total | Passed | Failed | Skipped | Duration |
|-------|--------|--------|---------|----------|
| N     | N      | N      | N       | Xs       |

---

## Healing

**Healing required:** Yes / No

| Test | Change | Reason | Outcome |
|------|--------|--------|---------|
| TC-001-03 | Fixed locator | Element renamed | ✅ PASS after heal |

---

## Failures

| Test | Classification | Root Cause | Action |
|------|----------------|------------|--------|
| TC-001-06 | PRODUCT_DEFECT | Error banner not shown for 500 response | Defect raised |

---

## Potential Product Defects

- **[HIGH]** TC-001-06: Error banner does not render when API returns HTTP 500. Expected: error message visible. Actual: page shows blank state.

---

## Risks / Gaps

- Live Map tab not tested (ADS-B data is non-deterministic)
- Delay bar visual accuracy not asserted (proportional rendering)
- AeroDataBox quota: all tests mock the API — quota preserved

---

## Final Status

PASS | PASS WITH RISKS | FAIL | BLOCKED

> Confidence: {HIGH/MEDIUM/LOW} — {reason}
```

## Final status decision

| Condition | Status |
|---|---|
| All automated tests pass, no defects | `PASS` |
| All automated tests pass, but gaps exist | `PASS WITH RISKS` |
| Any test fails with `PRODUCT_DEFECT` | `FAIL` |
| Servers not running or missing deps | `BLOCKED` |

## After this step

The report is the final output of the workflow. Save it to `.ai/reports/{storyId}-report.md`.

The Orchestrator marks `execution-context.json` with final status and closes the workflow.
