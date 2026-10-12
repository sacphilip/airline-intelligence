# QA E2E Workflow — flight-tracker

## How to trigger

Give the QA Orchestrator a single user story file:

```
Run QA workflow for user-stories/US-001-search-by-flight-number.md
```

The Orchestrator reads `.ai/agents/qa-orchestrator.md` and drives the full pipeline.

---

## Pipeline

```
user-stories/US-NNN.md
       │
       ▼
┌──────────────────┐
│ Requirement Agent │  → requirements.json fragment
└──────────────────┘
       │
       ▼
┌──────────────────┐
│ Test Design Agent │  → testCases.json fragment
└──────────────────┘
       │
       ▼
┌──────────────────────────┐
│ Framework Discovery Agent │  → frameworkDiscovery.json fragment
└──────────────────────────┘
       │
       ▼
┌──────────────────┐
│ Automation Agent  │  → creates/updates test files
└──────────────────┘
       │
       ▼
┌──────────────────┐
│ Execution Agent   │  → executionResults.json fragment
└──────────────────┘
       │
  ┌────┴────┐
  │         │
PASS       FAIL
  │         │
  │         ▼
  │  ┌────────────────────┐
  │  │ Failure Analysis    │  → failures.json fragment
  │  └────────────────────┘
  │         │
  │    ┌────┴────┐
  │    │         │
  │  HEAL    PRODUCT
  │    │     DEFECT
  │    ▼
  │  ┌──────────────┐
  │  │ Healing Agent │  → healingAttempts.json fragment
  │  └──────────────┘
  │         │
  │         ▼
  │  ┌──────────────────┐
  │  │ Execution Agent   │  → re-run affected tests
  │  │ (re-run mode)     │
  │  └──────────────────┘
  │         │
  └────┬────┘
       │
       ▼
┌──────────────────┐
│ Reporting Agent   │  → .ai/reports/US-NNN-report.md
└──────────────────┘
```

---

## Shared state

All agents read and write `.ai/workflows/execution-context.json` (runtime file, not committed).

Schema: `.ai/workflows/execution-context.schema.json`

---

## Agent locations

| Agent | Prompt file |
|---|---|
| Orchestrator | `.ai/agents/qa-orchestrator.md` |
| Requirement | `.ai/agents/requirement-agent.md` |
| Test Design | `.ai/agents/test-design-agent.md` |
| Framework Discovery | `.ai/agents/framework-discovery-agent.md` |
| Automation | `.ai/agents/automation-agent.md` |
| Execution | `.ai/agents/execution-agent.md` |
| Failure Analysis | `.ai/agents/failure-analysis-agent.md` |
| Healing | `.ai/agents/healing-agent.md` |
| Reporting | `.ai/agents/reporting-agent.md` |

---

## Reports

Output: `.ai/reports/{storyId}-report.md`

Example: `.ai/reports/US-001-report.md`

---

## Key policies

- **AeroDataBox quota**: All tests mock API calls. Never run live API calls in automated tests.
- **Healing limit**: Max 2 attempts per test.
- **Product defects**: Never healed. Test expectation is preserved, defect is reported.
- **Sequential execution**: `workers: 1` — tests share app state, run one at a time.

---

## User stories covered by existing specs

| Story | Spec file | Tests |
|---|---|---|
| US-001 | `tests/specs/us-001-search-by-flight-number.spec.ts` | 8 |
| US-002 | `tests/specs/us-002-search-by-route.spec.ts` | 8 |
| US-003 | `tests/specs/us-003-flight-card.spec.ts` | 10 |
| US-005 | `tests/specs/us-005-flight-history.spec.ts` | 9 |
| US-006 | `tests/specs/us-006-airline-profile.spec.ts` | 15 |
| NAV    | `tests/specs/app-navigation.spec.ts` | 10 |

New stories → run Orchestrator with that story's `.md` file.
