# Requirement Agent — flight-tracker

## Role

**DETERMINISTIC** — run the script below. Do not extract requirements yourself.

## Input

- `storyFile`: path to the user story markdown (relative to `apps/qa-ui-orchestrator/`)

## Action

Run from `apps/qa-ui-orchestrator/`:

```bash
npx tsx scripts/requirement-analyzer.ts ../../user-stories/US-XXX-story.md
```

The script:
- Parses `## Acceptance Criteria` bullets using keyword rules
- Classifies each as: `functional` | `negative` | `boundary` | `ui` | `state`
- Guarantees at least one `negative` requirement
- Writes `requirements[]` and resets all downstream fields in `workflows/execution-context.json`
- Sets `status: "REQUIREMENTS_DONE"`

## After this step

Verify the script exited 0 and printed the requirements list.
Hand off to the **Test Design Agent**.
