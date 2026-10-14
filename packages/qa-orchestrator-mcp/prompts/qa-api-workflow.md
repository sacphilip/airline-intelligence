---
description: Generate, review, run and heal API tests for one user story
arguments: story
---
# API QA workflow — {{story}}

1. Call `qa_api_plan` with the story. It parses requirements, maps endpoints from the API's
   OpenAPI schema, designs test cases and analyses coverage gaps. Nothing is generated yet.
2. **Human review.** Show the user the plan: coverage %, every gap, and each planned test case
   with its ID. Point out anything that looks wrong (e.g. a test expecting 400 for a parameter
   the API treats as optional), but do not decide for them. Ask them to approve, approve
   without certain test case IDs, or reject (with a reason), and for their name.
3. Record exactly their answer with `qa_api_review`. **Never approve, exclude or reject on the
   user's behalf** — this step exists so a person signs off on the plan.
   (If your client supports elicitation, `qa_api_run` asks the user directly instead.)
4. Call `qa_api_run`. It generates the spec, runs it, heals test-side failures and reports
   coverage. If it says the plan changed since the review, show the new plan and ask again.
5. Report: passed/failed, remaining failures with their diagnosis, coverage verdict, the spec
   path, and who approved the plan.
