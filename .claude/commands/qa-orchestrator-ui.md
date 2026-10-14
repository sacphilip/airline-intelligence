Run the QA UI Orchestrator for the user story identified by: $ARGUMENTS

If $ARGUMENTS is empty or blank, list all files in `user-stories/` and ask the user to pick one by ID. Do not proceed until a story is specified.

All scripts below run from `apps/qa-ui-orchestrator/`. Install dependencies there first if `node_modules/` is absent: `npm install`.

---

## Step 1 — Resolve the story file

The argument may be:
- A bare number: `6` → `user-stories/US-006-*.md`
- A story ID: `US-006` → `user-stories/US-006-*.md`
- A full filename: use directly

If nothing matches, list `user-stories/` and stop.

---

## Step 2 — Initialise execution context

Reset `apps/qa-ui-orchestrator/workflows/execution-context.json` to:

```json
{
  "storyId": "<US-NNN from filename>",
  "storyFile": "../../user-stories/<filename>",
  "status": "PENDING",
  "requirements": [],
  "testCases": [],
  "frameworkDiscovery": {},
  "automatedTests": [],
  "executionResults": [],
  "failures": [],
  "healingAttempts": [],
  "defects": []
}
```

Read `apps/qa-ui-orchestrator/config/qa-config.yaml` and keep it in context for the rest of the run.

---

## Stage 1 — Requirements (DETERMINISTIC)

```bash
cd apps/qa-ui-orchestrator && npx tsx scripts/requirement-analyzer.ts ../../user-stories/<filename>
```

The script writes `requirements[]` and sets `status: "REQUIREMENTS_DONE"` in the execution context.
Confirm the count and list the requirement IDs before continuing.

---

## Stage 2 — Test Design (LLM)

Read `apps/qa-ui-orchestrator/agents/test-design-agent.md` and follow its instructions using the
requirements from the execution context. Write the resulting `testCases[]` back into
`workflows/execution-context.json` and set `status: "TEST_DESIGN_DONE"`.

Show the user a summary: total test cases, breakdown by priority (P0/P1/P2/P3) and automation
strategy (UI / MANUAL / NOT_AUTOMATABLE).

---

## Stage 3 — Framework Discovery (DETERMINISTIC)

```bash
cd apps/qa-ui-orchestrator && npx tsx scripts/framework-scanner.ts
```

The script writes `frameworkDiscovery{}` and sets `status: "FRAMEWORK_DISCOVERED"`.
Report existing pages, fixtures, and any reusable items found.

---

## Stage 4a — Base spec generation (DETERMINISTIC)

```bash
cd apps/qa-ui-orchestrator && npx tsx scripts/ui-test-generator.ts
```

The script creates a spec file at `tests/specs/us-NNN-slug.spec.ts` (relative to the project root),
writes `automatedTests[]`, and sets `status: "AUTOMATION_DONE"`.
Report the spec path and count of `// TODO: [MCP-ENRICH]` stubs.

---

## Stage 4b — Assertion enrichment (Playwright MCP)

Only run if the frontend is reachable: `curl -s http://localhost:3000`

Read `apps/qa-ui-orchestrator/agents/automation-agent.md` — Stage 2 — and follow its Playwright MCP
enrichment instructions. For each `// TODO: [MCP-ENRICH]` in the generated spec:
1. Use Playwright MCP to navigate to the relevant page at `http://localhost:3000`
2. Interact as the scenario describes
3. Replace the TODO with real, specific assertions based on what you observe
4. Mock all API calls via `page.route()` — **AeroDataBox quota is nearly exhausted**
5. Prefer `getByRole` / `getByLabel` / `getByPlaceholder` locators; read the component source
   before writing any locator

If the frontend is not running, skip this stage, note it in the report, and continue.

---

## Stage 5 — Test execution (DETERMINISTIC)

Check both servers before running:

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000   # must be 200
curl -s -o /dev/null -w "%{http_code}" http://localhost:3100   # must be 200
```

If either is unreachable, set `status: "BLOCKED"` and go straight to Stage 9.

Otherwise run from the **project root**:

```bash
npx playwright test <spec-file> --reporter=json --output=test-results/ 2>&1
```

Parse the JSON output: write `executionResults[]` into `workflows/execution-context.json`.
Set `status: "PASS"` if all pass, `"FAIL"` if any fail.

---

## Stage 6 — Failure analysis (DETERMINISTIC + LLM for UNKNOWN)

**Only if status is "FAIL".**

```bash
cd apps/qa-ui-orchestrator && npx tsx scripts/failure-analyzer.ts
```

The script writes `failures[]` with `classification` and `action` fields.
For any failure classified as `UNKNOWN`, read `apps/qa-ui-orchestrator/agents/failure-analysis-agent.md`
and manually review the error + screenshot to assign a classification.

Decision gate:
- All failures are `PRODUCT_DEFECT` or `INVESTIGATE` → skip stages 7 & 8, go to 9
- Any `HEAL` action → continue to stage 7

---

## Stage 7 — Healing (DETERMINISTIC + LLM)

**Only if there are `HEAL` actions in `failures[]`.**

```bash
cd apps/qa-ui-orchestrator && npx tsx scripts/test-healer.ts
```

For TIMING and simple LOCATOR failures the script patches automatically.
For complex LOCATOR or other healable failures, read `apps/qa-ui-orchestrator/agents/healing-agent.md`
and apply the fix manually, respecting `healingPolicy.maxAttempts: 2`.

Write `healingAttempts[]` into the execution context.

---

## Stage 8 — Re-execution (DETERMINISTIC)

**Only if any tests were healed in stage 7.**

Re-run the spec from the project root (same command as stage 5). Update `executionResults[]`.

---

## Stage 9 — Report (DETERMINISTIC)

```bash
cd apps/qa-ui-orchestrator && npx tsx scripts/report-generator.ts
```

The script writes a final report to `apps/qa-ui-orchestrator/reports/`.
Show the user: pass/fail counts, any unresolved defects, report path.

---

## Stage 10 — Git commit and push

Commit the generated spec file to branch `qa/<story-id-lower>` and push:

If the push fails, show the warning and give the user the manual command:
```bash
git checkout -B qa/<story-id-lower>
git add tests/specs/<spec-file>
git commit -m "test(<story-id-lower>): add generated UI spec"
git push -u origin qa/<story-id-lower>
```

---

## Final report to user

- Story tested and reviewer (if a test-design review was done)
- Stage 4b: enriched or skipped (and why)
- Pass / Fail / Total counts
- Failing test titles and first error line
- Generated spec path
- HTML report path
- QA branch the spec was pushed to, or push failure warning
