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

4. After the run completes, report:
   - Which story was tested
   - Passed / Failed / Total counts
   - List any failing test titles and their first error line
   - Path to the generated test file
   - Path to the HTML report (if generated)
