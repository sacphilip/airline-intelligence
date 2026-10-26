---
description: Turn generated test stubs into real tests by observing the app in the built-in browser
arguments: story
---
# Enrich the generated spec — {{story}}

`qa_ui_generate_spec` wrote stubs marked `// TODO: [MCP-ENRICH]` and `test.fixme(...)`.
Replace each with real interactions and assertions, based on what the running app actually does.

For each stub:

1. Make sure the app is running (the project's dev server; check its Playwright `webServer`
   config or ask the user how to start it).
2. Use the browser tools to open the page (`browser_navigate`) and perform the steps in the
   comment (`browser_click`, `browser_type`, …). Take a `browser_snapshot` to see roles,
   names and text exactly as rendered.
3. Read the component source for the elements you touch — never guess a locator.
4. Write the test: the same steps in Playwright, then assertions on what you observed.
5. Remove the `TODO: [MCP-ENRICH]` comment and the `test.fixme(...)` line.

Reuse what `qa_ui_scan_framework` found: page objects, fixtures and test data, rather than
writing new locators inline.

Never write a selector (`getByRole`, `getByText`, `locator(...)`, …) in a spec or page object.
Specs call page objects; page objects read their locators from the project's locator JSON files
(`tests/locators/<page>.locators.json`, entry format documented in `tests/support/locators.ts`).
For a new element, add an entry to the JSON file of the page it belongs to and expose it from
that page object.

## Locator priority

1. `getByRole` 2. `getByLabel` 3. `getByPlaceholder` 4. `getByText` (with `{ exact: true }` for
short strings) 5. `data-testid` only when nothing semantic exists.

## Rules

- No `page.waitForTimeout()` — rely on auto-waiting and assertion timeouts.
- Don't fake API responses unless the project's existing tests already do; prefer the real backend.
- A stub you can't make deterministic: leave `test.fixme` with a comment explaining why.
