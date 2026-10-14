# Framework Discovery Agent — flight-tracker

## Role

**DETERMINISTIC** — run the script below. Do not inspect files yourself.

## Action

Run from `apps/qa-ui-orchestrator/`:

```bash
npx tsx scripts/framework-scanner.ts
```

The script:
- Lists all classes in `tests/pages/*.ts`
- Lists all fixture exports from `tests/fixtures/test.fixture.ts`
- Lists all exports from `tests/data/*.ts`
- Lists all existing specs in `tests/specs/*.spec.ts`
- Flags if a spec for this story already exists
- Identifies which pages, fixtures and mock data are reusable for this story
- Writes `frameworkDiscovery{}` to `workflows/execution-context.json`
- Sets `status: "FRAMEWORK_DISCOVERED"`

## After this step

Verify the script exited 0.
Hand off to the **Automation Agent**.
