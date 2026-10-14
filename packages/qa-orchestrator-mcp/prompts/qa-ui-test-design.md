---
description: Design risk-based UI test cases from a story's extracted requirements
arguments: story
---
# Test design — {{story}}

Read the requirements returned by `qa_ui_analyze_story` (or call it), and the story file itself
for context. Design a risk-based suite and save it with `qa_ui_save_test_cases`.

## Test case shape

```json
{
  "id": "TC-001-01",
  "requirement": "AC-01",
  "scenario": "Search tab becomes active after clicking it",
  "preconditions": "App is loaded",
  "testData": "none",
  "steps": ["Click the Search tab"],
  "expected": "Tab is selected (aria-selected=true) and the search form is visible",
  "type": "Functional",
  "priority": "P1",
  "automation": true,
  "automationStrategy": "UI",
  "reason": "Core navigation"
}
```

IDs are `TC-{story number}-{nn}`; `requirement` must be one of the extracted requirement IDs.

## Cover at minimum

- **Functional** — the primary action works; visible data renders; navigation works
- **Negative** — empty or invalid input, error responses, not-found results
- **Boundary** — minimum/maximum lengths and values, empty result sets
- **UI states** — loading indicators, error banners, empty states, expandable sections
- **State transitions** — deep links / routing, values carried between views

## Priorities

P0 blocks the feature · P1 core journey · P2 important, not blocking · P3 edge case.

## Automation

Set `automation: false` only for checks needing human judgement or data that can't be made
deterministic. Prefer asserting on the data the app actually returns over fixed values when
the data is live.

Show the designed cases to the user and confirm before saving.
