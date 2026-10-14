Run the QA API Orchestrator for the user story identified by: $ARGUMENTS

If $ARGUMENTS is empty or blank, list all files in `user-stories/` and ask the user to pick one by ID. Do not proceed until a story is specified.

Steps:
1. Resolve the story file. The argument may be any of these formats:
   - A bare number: `1` → look for `user-stories/US-001-*.md`
   - A story ID: `US-001` or `us-001` → look for `user-stories/US-001-*.md`
   - A full filename: `US-001-search-by-flight-number.md` → use directly
   Match case-insensitively. If nothing matches, list the available stories and stop.

2. Check whether the orchestrator has been built:
   - If `apps/qa-api-orchestrator/dist/src/cli.js` does not exist, run `npm run build` in `apps/qa-api-orchestrator/` first.

3. Run the orchestrator using the dev CLI (tsx) so no global install is needed:
   ```
   cd apps/qa-api-orchestrator && npm run qa ../../<resolved-story-path>
   ```
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

4. After the run completes, report:
   - Which story was tested
   - Who approved the test plan and any excluded test case IDs
   - Passed / Failed / Total counts
   - List any failing test titles and their first error line
   - Path to the generated test file
   - Path to the HTML report (if generated)
   - The QA feature branch the spec was pushed to (look for `12/12 GIT PUSH` lines in the output).
     If the push failed, show the warning and remind the user they can push manually:
     `git checkout -B qa/<story-id-lower> && git add <spec-path> && git commit -m "..." && git push -u origin qa/<story-id-lower>`
   - If the run stopped for review (exit code 3) or was rejected (exit code 4), skip git push — nothing was generated.
