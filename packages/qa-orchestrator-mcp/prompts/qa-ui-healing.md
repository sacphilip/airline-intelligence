---
description: Heal locator, data and test-logic failures safely
arguments: story
---
# Healing — {{story}}

`qa_ui_heal_timing` fixes timing failures. The rest (`needsAgent`) are yours.

## A change is allowed only if all of these hold

1. The requirement is unchanged — you are not relaxing what must be true.
2. The app behaves correctly per the requirement.
3. The failure is caused by the test, not the app.
4. The new locator or wait is at least as stable as the old one.
5. No assertion is weakened or removed.
6. You confirmed the new locator against the application source (or the live page).

If any fails, reclassify the failure as `PRODUCT_DEFECT` (`qa_ui_update_failures`) and don't heal.

## By classification

- **LOCATOR_FAILURE** — find the real element in the source or a `browser_snapshot`; use the
  locator priority (role → label → placeholder → text → test id). Fix shared page objects
  only when the locator is shared.
- **TEST_DATA_FAILURE** — fix the test's data or expectations to match correct app output.
- **TEST_DEFECT** — fix the wrong assertion or flow; replace, don't delete.

Never edit application source to make a test pass. Maximum 2 attempts per test; after that
the test is UNRESOLVED. Re-run with `qa_ui_run_spec` after healing.
