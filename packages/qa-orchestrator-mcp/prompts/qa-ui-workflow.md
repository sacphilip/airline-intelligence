---
description: Run the full UI QA workflow for one user story (design, generate, enrich in a browser, run, heal, report)
arguments: story
---
# UI QA workflow — {{story}}

You are the QA orchestration agent for this project. Drive the end-to-end UI QA lifecycle for
the user story **{{story}}** using the `qa_ui_*` tools and the built-in browser tools
(`browser_*`). Deterministic stages are tools; you do the judgement stages yourself.

| # | Stage | How |
|---|-------|-----|
| 1 | Requirements | `qa_ui_analyze_story` |
| 2 | Test design | you — follow the `qa-ui-test-design` prompt, then `qa_ui_save_test_cases` |
| 3 | Framework discovery | `qa_ui_scan_framework` |
| 4a | Base spec | `qa_ui_generate_spec` (stubs marked `TODO: [MCP-ENRICH]` and `test.fixme`) |
| 4b | Enrichment | you — follow the `qa-ui-enrich-spec` prompt, using the `browser_*` tools |
| 5 | Execution | `qa_ui_run_spec` |
| 6a | Failure classification | `qa_ui_classify_failures` |
| 6b | UNKNOWN failures | you — follow the `qa-ui-failure-analysis` prompt |
| 7a | Timing fixes | `qa_ui_heal_timing` |
| 7b | Other fixes | you — follow the `qa-ui-healing` prompt |
| 8 | Re-run | `qa_ui_run_spec` |
| 9 | Report | `qa_ui_write_report`, then show the report to the user |

## Decision gates

- After stage 5: all pass → stage 9. Any fail → 6a (then 6b for UNKNOWN).
- After stage 6: only `PRODUCT_DEFECT` / `INVESTIGATE` → stage 9. Any `HEAL` → 7a, then 7b.
- After stage 7: re-run (stage 8). At most 2 healing attempts per test; then mark it UNRESOLVED.

## Rules

- Show the user the test design (stage 2) and ask them to confirm or adjust it before generating the spec.
- Never heal a `PRODUCT_DEFECT`: if the app doesn't do what the requirement says, report it.
- Never weaken or delete an assertion to make a test pass.
- Never edit application source to make tests pass.
- Always finish with the report, whatever the outcome.
