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

**Prerequisite — GitHub CLI.** Run `gh auth status`. If `gh` is missing or not logged in, **stop**
and tell the user to run, once: `winget install --id GitHub.cli` (then open a new terminal) and
`gh auth login` (GitHub.com → HTTPS → browser). The run must end with a PR (Stage 10).

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

## Stage 2b — Coverage gap analysis (DETERMINISTIC + human review)

```bash
cd apps/qa-ui-orchestrator && npx tsx scripts/coverage-analyzer.ts
```

The script parses all acceptance-criteria bullets from the story, maps each to the designed test
cases by keyword matching, and calculates coverage %.

**Exit code 3 — human review required.** The script prints the full coverage packet (requirement
table, gap list, test case list) and writes two files:
- `reports/review/<ID>-ui-coverage.md` — human-readable summary
- `reports/review/<ID>-ui-coverage.json` — decision file (`"decision": "pending"`)

When this happens:
- Show the user the coverage %, every gap, and the planned test cases with their IDs
- Point out any obvious gaps (e.g. AC not covered by any TC) but do not decide for them
- Ask the user to choose: approve, approve without certain test case IDs, or reject (reason required)
  Also ask for the reviewer name to record
- **Never approve, exclude or reject on the user's behalf**
- Write exactly the user's answer into `<ID>-ui-coverage.json`
  (`decision`, `excludedTestCaseIds`, `reviewer`, `comment`); leave `storyId`, `tcHash` and
  `testCaseIds` unchanged
- Then re-run the coverage-analyzer (it reads the decision file and continues on approval)

If `excludedTestCaseIds` is non-empty, remove those IDs from `testCases[]` in the execution context
before proceeding to Stage 3.

**Exit code 0** — coverage already approved or no ACs found; continue to Stage 3.
**Exit code 1** — script error; show the error and stop.

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
4. Use the **real backend** — no `page.route()` mocks or canned responses. Assert on what the
   backend actually returns (capture it with `page.waitForResponse`, as `tests/support/live.ts`
   does) rather than fixed values, since flight data is live. A state the real backend can't
   produce on demand (e.g. a 500) is marked not automatable with a reason, not faked
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

## Stage 10 — Commit and open a Pull Request against `develop` (always the last step)

Skip only if no spec was generated (e.g. the coverage review was rejected).

**Which files.** The generated spec, plus every test-support file this run changed during
enrichment (4b) or healing (7) — e.g. page objects in `tests/pages/`, `tests/fixtures/`,
`tests/data/`. Never application source (`frontend/`, `backend/`), and never reports,
`test-results/`, `*.db*` or `tsconfig.tsbuildinfo`. List the files before committing.

**Work in a separate git worktree**, never in the main checkout (other sessions use it):
```bash
git fetch origin develop
git worktree add -B qa/<story-id-lower>-ui ../flight-tracker-wt/qa-<story-id-lower>-ui origin/develop
```
(If that worktree folder already exists from an earlier run, reuse it and run
`git -C <worktree> pull --rebase origin develop` instead of adding it again.)

Copy each file into the worktree at the same relative path, then commit only those files:
```bash
cp tests/specs/<spec-file> ../flight-tracker-wt/qa-<story-id-lower>-ui/tests/specs/
# …and any changed tests/pages|fixtures|data files, same relative paths
cd ../flight-tracker-wt/qa-<story-id-lower>-ui
git add tests/specs/<spec-file> <other files by name>
git commit -F <message-file>      # "test(<story-id-lower>): add UI spec" + summary bullets + your co-author line
git push -u origin qa/<story-id-lower>-ui
```
If a copied page object conflicts with a newer version on `develop`, stop and show the user the
difference instead of overwriting it. Never `git add -A`, `--no-verify` or force-push; if the push
is rejected, `git pull --rebase` and push again.

**Open the PR** — **as a draft if any test failed, was skipped as not enriched, or the run was
BLOCKED**:
```bash
gh pr create --repo sacphilip/airline-intelligence --base develop --head qa/<story-id-lower>-ui \
  --title "test(<story-id-lower>): UI tests for <story title>" --body-file <body-file> [--draft]
```
If a PR for the branch already exists, update it (`gh pr edit qa/<story-id-lower>-ui --body-file <body-file>`)
and report its URL (`gh pr view qa/<story-id-lower>-ui --json url -q .url`).
If `gh pr create` fails, show the error and give the user
`https://github.com/sacphilip/airline-intelligence/compare/develop...qa/<story-id-lower>-ui?expand=1`.
Don't report the run as finished without a PR URL or that link.

**PR body template:**
```markdown
## UI tests for <story-id> — <story title>
User story: `user-stories/<filename>.md`

## Coverage review (Stage 2b)
<coverage %> · approved by <reviewer><; excluded: <ids> if any>

## Results
✅ <passed> passed · ❌ <failed> failed · ⏭ <skipped> skipped · status <PASS | FAIL | BLOCKED>
Enrichment (4b): <done | skipped — reason>

<if failures: one line per failing test — id, first error line, classification>
<if product defects: one line each — these are app bugs, not test bugs>

## Files
<every committed file, one per line, with created / modified>

## How to run
`npx playwright test <spec-file>` from the repo root (frontend :3000 and backend :3100 running)

---
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---

## Final report to user

- Story tested and coverage reviewer name + coverage % from Stage 2b
- Stage 4b: enriched or skipped (and why)
- Pass / Fail / Total counts
- Failing test titles and first error line
- Generated spec path
- HTML report path
- QA branch (`qa/<story-id-lower>-ui`), worktree path, and the PR URL (or the manual compare link if PR creation failed)
