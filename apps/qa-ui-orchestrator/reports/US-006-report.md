# QA Automation Report

**Story:** US-006 — ../../user-stories/US-006-airline-profile.md
**Date:** 2026-10-14
**Status:** ✅ PASS

---

## Requirement Analysis

11 requirement(s) extracted — 9 functional, 1 boundary, 1 negative

---

## Test Cases

| Total | Automated | Not automatable |
|-------|-----------|-----------------|
| 16 | 16 | 0 |

---

## Coverage

| TC ID | Scenario | Type | Priority | Automation | Result |
|-------|----------|------|----------|------------|--------|
| TC-006-01 | Airlines tab is accessible from main navigation | Functional | P0 | UI | ✅ PASS |
| TC-006-02 | Valid IATA search returns airline name and codes | Functional | P1 | UI | ✅ PASS |
| TC-006-03 | Reliability score ring shows a value between 0 and 100 | Functional | P1 | UI | ✅ PASS |
| TC-006-04 | On-time performance percentage is displayed | Functional | P1 | UI | ✅ PASS |
| TC-006-05 | Average delay value is displayed in minutes | Boundary | P1 | UI | ✅ PASS |
| TC-006-06 | Cancellation rate percentage is displayed | Functional | P2 | UI | ✅ PASS |
| TC-006-07 | Score breakdown section shows per-component bars | Functional | P2 | UI | ✅ PASS |
| TC-006-08 | Delay distribution section renders 5 buckets | Functional | P2 | UI | ✅ PASS |
| TC-006-09 | Top routes section renders route list | Functional | P2 | UI | ✅ PASS |
| TC-006-10 | Top airports section renders airport list | Functional | P2 | UI | ✅ PASS |
| TC-006-11 | Fleet section renders tail numbers | Functional | P2 | UI | ✅ PASS |
| TC-006-12 | Submitting empty IATA input shows validation error | Negative | P0 | UI | ✅ PASS |
| TC-006-13 | API error response shows error banner | Negative | P1 | UI | ✅ PASS |
| TC-006-14 | Loading indicator is shown while API request is in flight | Functional | P1 | UI | ✅ PASS |
| TC-006-15 | Hash routing #airline/6E opens Airlines tab and pre-fills IATA input | Functional | P1 | UI | ✅ PASS |
| TC-006-16 | Airline with no data shows appropriate empty state | Negative | P2 | UI | ✅ PASS |

---

## Automation Changes

### Created
- `tests/specs/us-006-airline-profile.spec.ts`
- `tests/specs/us-006-airline-profile.spec.ts`
- `tests/specs/us-006-airline-profile.spec.ts`
- `tests/specs/us-006-airline-profile.spec.ts`
- `tests/specs/us-006-airline-profile.spec.ts`
- `tests/specs/us-006-airline-profile.spec.ts`
- `tests/specs/us-006-airline-profile.spec.ts`
- `tests/specs/us-006-airline-profile.spec.ts`
- `tests/specs/us-006-airline-profile.spec.ts`
- `tests/specs/us-006-airline-profile.spec.ts`
- `tests/specs/us-006-airline-profile.spec.ts`
- `tests/specs/us-006-airline-profile.spec.ts`
- `tests/specs/us-006-airline-profile.spec.ts`
- `tests/specs/us-006-airline-profile.spec.ts`
- `tests/specs/us-006-airline-profile.spec.ts`
- `tests/specs/us-006-airline-profile.spec.ts`

### Framework reuse
- AppPage — tab navigation, hash routing (tests/pages/AppPage.ts)
- FlightSearchPage — number/route search (tests/pages/FlightSearchPage.ts)
- AirlinePage — airline profile lookup (tests/pages/AirlinePage.ts)
- TEST_DATA — standard test inputs (tests/data/test-data.ts)

---

## Execution

| Total | Passed | Failed | Skipped | Duration |
|-------|--------|--------|---------|----------|
| 16 | 16 | 0 | 0 | 16.4s |

---

## Healing

| Test | Change | Reason | Outcome |
|------|--------|--------|---------|
| TC-006-02 | Removed over-broad getByText('6E') assertion | Strict mode violation — matched search hint text and profile code div simultaneously | ✅ PASS |
| TC-006-10 | Scoped span.font-mono locator to the Airports section via section.filter(heading) | Locator resolved to a hidden ETH616 span in the rankings table instead of an airport chip | ✅ PASS |

---

## Product Defects

_No product defects found._

---

## Final Status

✅ **PASS**
