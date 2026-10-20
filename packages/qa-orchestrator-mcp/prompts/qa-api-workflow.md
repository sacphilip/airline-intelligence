---
description: Generate, review, run and heal API tests for one user story
arguments: story
---
# API QA workflow — {{story}}

1. Call `qa_api_plan` with the story. It parses requirements, maps endpoints from the API's
   OpenAPI schema, designs test cases and analyses coverage gaps. Nothing is generated yet.

2. **Coverage gap review (human gate).** If `qa_api_plan` returns a coverage gap analysis
   (heading "Coverage gap analysis"), present it to the user now — before showing the test
   cases. Point out any gaps and what they mean. Ask whether to proceed with the current
   coverage or revise the design, and for their name. Then call `qa_api_coverage_review`
   with exactly what they said. **Never decide "proceed" or "revise" yourself.**
   - If `"revise"`: stop here. Help the user update the story or implementation section
     to add missing acceptance criteria, then re-run `qa_api_plan` from step 1.
   - If `"proceed"`: call `qa_api_plan` again to get the full test plan (the coverage gate
     is now approved and the plan review packet will be returned).

3. **Test plan review (human gate).** Show the user the plan: coverage %, every gap, and
   each planned test case with its ID. Point out anything that looks wrong (e.g. a test
   expecting 400 for a parameter the API treats as optional), but do not decide for them.
   Ask them to approve, approve without certain test case IDs, or reject (with a reason),
   and for their name.

4. Record exactly their answer with `qa_api_review`. **Never approve, exclude or reject on
   the user's behalf** — this step exists so a person signs off on the plan.
   (If your client supports elicitation, `qa_api_run` asks the user directly instead.)

5. Call `qa_api_run`. It generates the spec, runs it, heals test-side failures and reports
   coverage. If it says the plan changed since the review, show the new plan and ask again.

6. Report: passed/failed, remaining failures with their diagnosis, coverage verdict, the spec
   path, and who approved both gates.
