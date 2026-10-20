# Execution Agent — flight-tracker

## Role

**DETERMINISTIC** — run the commands below. Do not interpret results yourself.

## Preconditions

Verify servers are running before executing:

```bash
# Frontend must be reachable
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 | grep -q 200 || echo "BLOCKED: frontend not running"

# Backend must be reachable
curl -s -o /dev/null -w "%{http_code}" http://localhost:3100 | grep -q 200 || echo "BLOCKED: backend not running"
```

If either is blocked, set `status: "BLOCKED"` in `workflows/execution-context.json` and stop.

## Execution

Read the spec file from `automatedTests[0].file` in `workflows/execution-context.json`, then run
from the project root:

```bash
npx playwright test <spec-file> --reporter=json --output=test-results/
```

The JSON reporter writes results to stdout. Parse it and write `executionResults[]` into
`workflows/execution-context.json` in this shape per test:

```json
{ "testId": "TC-NNN-NN", "result": "PASS|FAIL|SKIP", "duration": 1234, "error": "..." }
```

Map Playwright's `status` field: `"passed"` → `"PASS"`, `"failed"` → `"FAIL"`, `"skipped"` → `"SKIP"`.

For failed tests include `error` (the first assertion error message) and `screenshot`/`trace` paths
from `test-results/` if they exist.

## After targeted run

If all targeted tests pass, run the full suite to catch regressions:

```bash
npx playwright test --reporter=list
```

## Set final status

- All pass → `status: "PASS"`
- Any fail → `status: "FAIL"`
- Could not start → `status: "BLOCKED"`

## After this step

Hand off to:
- **Failure Analysis Agent** if any failures
- **Reporting Agent** if all passed or blocked
