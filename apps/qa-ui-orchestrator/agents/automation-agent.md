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
- One test stub per automatable test case (no API mocks — tests run against the real backend)
- A `// TODO: [MCP-ENRICH] <scenario>` comment in each stub where assertions are needed

It also writes `automatedTests[]` to `workflows/execution-context.json` and sets `status: "AUTOMATION_DONE"`.

---

## Step 2 — MCP enrichment (Playwright MCP / LLM)

Only do this step if the frontend is running at `http://localhost:3000`.

Open the generated spec. For every `// TODO: [MCP-ENRICH]` comment:

1. Use the `playwright` MCP to navigate to `http://localhost:3000`
2. Let the real backend serve every request — don't add `page.route()` mocks
3. Perform the interaction described in the TODO comment
4. Observe exactly what the page renders: text content, attribute values, element states
5. Replace the TODO comment with real assertions based on what you observed

### Locator priority (from config/qa-config.yaml)
1. `getByRole` — ARIA roles
2. `getByLabel` — form labels
3. `getByPlaceholder` — inputs
4. `getByText` — visible text (add `{ exact: true }` for short strings to avoid strict-mode violations)
5. `data-testid` — only when semantic locators are unavailable

### Where locators live

Locators are never written in a spec or a page object. Every locator is an entry in
`tests/locators/<page>.locators.json`, and the page object in `tests/pages/` exposes it
(`frameworkDiscovery.existingLocators` lists every file and key):

```json
"searchButton": { "role": "button", "name": "Search" },
"airlineRow":   { "testId": "route-airline-{{iata}}" }
```

```ts
get searchButton() { return this.loc.get('searchButton'); }
airlineRow(iata: string) { return this.loc.get('airlineRow', { iata }); }
```

The entry format (`role`/`text`/`placeholder`/`label`/`testId`/`css`, plus `within`, `filter`,
`or`, `nth`/`first`/`last`, `{{param}}` and `{ "regex", "flags" }`) is documented at the top of
`tests/support/locators.ts`. Reuse an existing key when one fits; otherwise add the entry to
the JSON file of the page it belongs to, and a getter or method to that page object. A new
page or component gets its own JSON file and page object.

### Rules
- Read the component source (`frontend/src/components/`) before writing locators — never guess
- No `page.getByRole/getByText/locator(...)` in specs or page objects — specs call page objects,
  page objects read `tests/locators/*.locators.json`
- Use the real backend; no `page.route()` mocks. Flight data is live, so assert on the response the
  page actually received (`captureApi()` in `tests/support/live.ts` captures it) rather than fixed values
- A state the real backend can't produce on demand (e.g. a 500) is not faked: leave the test as
  `test.fixme` with the reason, and mark the case `automation: false` in the execution context
- No `page.waitForTimeout()` — use Playwright auto-waiting and assertion timeouts
- Never weaken an assertion; replace wrong ones with correct ones

---

## After this step

Hand off to the **Execution Agent**.
