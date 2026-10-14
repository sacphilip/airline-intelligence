# Automation Agent — flight-tracker

## Role

**HYBRID** — deterministic base generation, then Playwright MCP enrichment.

---

## Step 1 — Base generation (deterministic)

Run from `apps/qa-ui-orchestrator/`:

```bash
npx tsx scripts/ui-test-generator.ts
```

The script reads `testCases[]` from `workflows/execution-context.json` and writes a base spec to
`tests/specs/us-{NNN}-{slug}.spec.ts` containing:
- Correct imports and `test.describe` structure
- `mockApi()` helper intercepting all API endpoints with `page.route()`
- One test stub per automatable test case
- A `// TODO: [MCP-ENRICH] <scenario>` comment in each stub where assertions are needed

It also writes `automatedTests[]` to `workflows/execution-context.json` and sets `status: "AUTOMATION_DONE"`.

---

## Step 2 — MCP enrichment (Playwright MCP / LLM)

Only do this step if the frontend is running at `http://localhost:3000`.

Open the generated spec. For every `// TODO: [MCP-ENRICH]` comment:

1. Use the `playwright` MCP to navigate to `http://localhost:3000`
2. Set up the same `page.route()` mocks the spec uses (or let the real backend serve)
3. Perform the interaction described in the TODO comment
4. Observe exactly what the page renders: text content, attribute values, element states
5. Replace the TODO comment with real assertions based on what you observed

### Locator priority (from config/qa-config.yaml)
1. `getByRole` — ARIA roles
2. `getByLabel` — form labels
3. `getByPlaceholder` — inputs
4. `getByText` — visible text (add `{ exact: true }` for short strings to avoid strict-mode violations)
5. `data-testid` — only when semantic locators are unavailable

### Known locators for this project

| Element | Locator |
|---|---|
| Tab button | `page.getByRole('button', { name: 'Find Flight' })` |
| Flight number input | `page.getByPlaceholder(/6E 5321/i)` |
| Route From input | `page.getByPlaceholder('From (BLR)')` |
| Route To input | `page.getByPlaceholder('To (DEL)')` |
| Date input | `page.locator('input[type="date"]').first()` |
| Search button | `page.getByRole('button', { name: 'Search' })` |
| Airline IATA input | `page.getByPlaceholder(/IATA code/i)` |
| Error banner | `page.locator('[class*="destructive"]')` |
| Active tab | `expect(button).toHaveAttribute('aria-selected', 'true')` |

### Rules
- Read the component source (`frontend/src/components/`) before writing locators — never guess
- Mock all API calls via `page.route()` — AeroDataBox quota is nearly exhausted
- No `page.waitForTimeout()` — use Playwright auto-waiting and assertion timeouts
- Never weaken an assertion; replace wrong ones with correct ones

---

## After this step

Hand off to the **Execution Agent**.
