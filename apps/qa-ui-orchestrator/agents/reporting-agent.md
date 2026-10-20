# Reporting Agent — flight-tracker

## Role

**DETERMINISTIC** — run the script below. Do not write the report yourself.

## Action

Run from `apps/qa-ui-orchestrator/`:

```bash
npx tsx scripts/report-generator.ts
```

The script:
- Reads `workflows/execution-context.json`
- Templates a full QA Automation Report from the data
- Writes it to `reports/<storyId>-report.md`
- Prints the final status and pass/fail counts

## After this step

Read the generated report file and show it to the user.
The Orchestrator marks `workflows/execution-context.json` with final status and closes the workflow.
