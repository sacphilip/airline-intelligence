Run the QA API Orchestrator for the user story identified by: $ARGUMENTS

If $ARGUMENTS is empty or blank, list all files in `user-stories/` and ask the user to pick one by ID. Do not proceed until a story is specified.

Steps:
1. Resolve the story file. The argument may be any of these formats:
   - A bare number: `1` → look for `user-stories/US-001-*.md`
   - A story ID: `US-001` or `us-001` → look for `user-stories/US-001-*.md`
   - A full filename: `US-001-search-by-flight-number.md` → use directly
   Match case-insensitively. If nothing matches, list the available stories and stop.

   **Prerequisite — GitHub CLI.** Run `gh auth status`. If `gh` is missing or not logged in,
   **stop** and tell the user to run, once: `winget install --id GitHub.cli` (then open a new
   terminal) and `gh auth login` (GitHub.com → HTTPS → browser). The run must end with a PR.

2. Check whether the orchestrator has been built:
   - If `apps/qa-api-orchestrator/dist/src/cli.js` does not exist, run `npm run build` in `apps/qa-api-orchestrator/` first.

3. Run the orchestrator using the dev CLI (tsx) so no global install is needed:
   ```
   cd apps/qa-api-orchestrator && QA_SKIP_GIT=1 npm run qa ../../<resolved-story-path>
   ```
   (PowerShell: `$env:QA_SKIP_GIT = "1"; npm run qa ../../<resolved-story-path>`.)
   `QA_SKIP_GIT=1` turns off the orchestrator's own git phase, which would switch the shared
   checkout's branch; step 5 commits and opens the PR from a separate worktree instead.
   Pass through any environment variables already set (API_BASE_URL, OPENAI_URL, ANTHROPIC_API_KEY).
   Do not pass `--review=auto` or set `QA_REVIEW=auto` unless the user explicitly asks to skip the review.

   **Human review (exit code 3).** After coverage analysis the orchestrator stops for a human
   review of the test plan. Without a terminal it writes `reports/review/<ID>-review.md` (the
   plan: coverage, gaps, planned test cases) and `reports/review/<ID>-review.json` (the decision,
   `"decision": "pending"`), then exits with code 3. Nothing has been generated or run yet.
   When that happens:
   - Read `<ID>-review.md` and show the user the coverage %, every gap, and the planned test
     cases with their IDs. Point out anything that looks wrong (e.g. a test expecting 400 for a
     parameter the API treats as optional), but do not decide for them.
   - Ask the user to choose: approve, approve without certain test case IDs, or reject (a reason
     is required). Also ask for the reviewer name to record.
   - **Never approve, exclude or reject on the user's behalf**, and never edit the decision file
     with anything the user didn't say. This step exists so a person signs off on the plan.
   - Write exactly the user's answer into `<ID>-review.json` (`decision`, `excludedTestCaseIds`,
     `reviewer`, `comment`); leave `planHash` and `storyId` unchanged. Then run step 3 again.
   - If the run stops with exit code 3 again saying the plan changed, the story or API changed
     since the review: show the new packet and ask again.

   **Rejected (exit code 4).** Report the reviewer's reason; no tests were generated.
   **Error (exit code 2).** Show the error (e.g. an invalid decision file) and stop.

4. Once step 5 (commit + PR) is done, report:
   - Which story was tested
   - Who approved the test plan and any excluded test case IDs
   - Passed / Failed / Total counts
   - List any failing test titles and their first error line
   - Path to the generated test file
   - Path to the HTML report (if generated)
   - The PR URL from step 5

5. **Commit the spec and open a Pull Request against `develop` — always the last step.**
   Skip this step only if the run stopped for review (exit code 3) or was rejected (exit code 4):
   nothing was generated.

   Work in a separate **git worktree**, never in the main checkout (other sessions use it):
   ```
   git fetch origin develop
   git worktree add -B qa/<story-id-lower>-api ../flight-tracker-wt/qa-<story-id-lower>-api origin/develop
   ```
   (If that worktree folder already exists from an earlier run, reuse it and run
   `git -C <worktree> pull --rebase origin develop` instead of adding it again.)

   Copy the generated spec into the worktree at the same path, then commit only that file:
   ```
   cp apps/qa-api-orchestrator/tests/generated/<story-id-lower>.spec.ts ../flight-tracker-wt/qa-<story-id-lower>-api/apps/qa-api-orchestrator/tests/generated/
   cd ../flight-tracker-wt/qa-<story-id-lower>-api
   git add apps/qa-api-orchestrator/tests/generated/<story-id-lower>.spec.ts
   git commit -F <message-file>      # "test(<story-id-lower>): add generated API spec" + summary bullets + your co-author line
   git push -u origin qa/<story-id-lower>-api
   ```
   Never `git add -A`, never `--no-verify`, never force-push. If the push is rejected because
   the remote branch moved, `git pull --rebase` and push again.

   Open the PR (body template below) — **as a draft if any test is still failing**:
   ```
   gh pr create --repo sacphilip/airline-intelligence --base develop --head qa/<story-id-lower>-api \
     --title "test(<story-id-lower>): API tests for <story title>" --body-file <body-file> [--draft]
   ```
   If a PR for the branch already exists, update it instead (`gh pr edit qa/<story-id-lower>-api --body-file <body-file>`)
   and report its URL (`gh pr view qa/<story-id-lower>-api --json url -q .url`).
   If `gh pr create` fails, show the error and give the user
   `https://github.com/sacphilip/airline-intelligence/compare/develop...qa/<story-id-lower>-api?expand=1`.
   Don't report the run as finished without a PR URL or that link.

   **PR body template:**
   ```markdown
   ## API tests for <story-id> — <story title>
   User story: `user-stories/<filename>.md`

   ## Test plan review
   Approved by <reviewer> (<mode>)<; excluded: <ids> if any><; comment: "<comment>" if any>

   ## Results
   ✅ <passed> passed · ❌ <failed> failed · <total> total<; auto-healed: <n> if any>

   <if failures: one line per failing test — title, first error line, diagnosis (APPLICATION_BUG / TEST_BUG / …)>

   ## Coverage
   <score>% — <verdict>. <remaining gaps, one per line>

   ## Files
   - `apps/qa-api-orchestrator/tests/generated/<story-id-lower>.spec.ts`

   ## How to run
   `cd apps/qa-api-orchestrator && npx playwright test tests/generated/<story-id-lower>.spec.ts` (backend on :3100)

   ---
   🤖 Generated with [Claude Code](https://claude.com/claude-code)
   ```
