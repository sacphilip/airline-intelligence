---
description: Diagnose UI test failures the pattern classifier marked UNKNOWN
arguments: story
---
# Failure analysis — {{story}}

`qa_ui_classify_failures` classified failures by error pattern. For each one still
`UNKNOWN`:

1. Read its error (`qa_ui_get_context` → `executionResults`).
2. Look at the screenshot and trace paths recorded there, if any.
3. Read the test and the relevant application source.
4. Reproduce it in the built-in browser if the cause is still unclear.
5. Classify it, in this order:

| Question | Classification | Action |
|---|---|---|
| Does the app behave differently from the requirement? | `PRODUCT_DEFECT` | report, never heal |
| Locator finds nothing, but the element is on screen? | `LOCATOR_FAILURE` | heal |
| Assertion ran before the page was ready? | `TIMING_SYNCHRONIZATION` | heal |
| Test data doesn't match what the app shows? | `TEST_DATA_FAILURE` | heal |
| Server unreachable or unexpected response? | `ENVIRONMENT_FAILURE` / `NETWORK_API_FAILURE` | investigate |
| The test's own logic or assertion is wrong? | `TEST_DEFECT` | heal |

Record your classifications with `qa_ui_update_failures`.

**When in doubt, prefer `PRODUCT_DEFECT` over healing.** Never change a test's expectation to
match broken behaviour.
