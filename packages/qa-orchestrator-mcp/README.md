# qa-orchestrator-mcp

An MCP server that turns user stories into tested Playwright suites: API tests and UI tests,
with a human review gate before anything is generated, automatic healing of test-side
failures, and coverage reports. It includes the Playwright browser tools, so it's the only
MCP server a project needs for QA.

## Install without publishing

**In this repo (flight-tracker)**: the server is already registered in the committed `.mcp.json`
and `.vscode/mcp.json`. After pulling, build it once:

```bash
npm run orchestrator:build     # npm ci in packages/qa-orchestrator-mcp; `prepare` compiles dist/
```

Then restart the editor's MCP connection. Run it again after pulls that change the package.

**In another project, from a local clone of this repo:**

```bash
npm install --save-dev <path-to-clone>/packages/qa-orchestrator-mcp
npx qa-orchestrator-mcp init --api-url http://localhost:3100
```

This links the clone (a `file:` dependency), so build it there first (`npm run orchestrator:build`)
and keep the clone where it is. To copy it instead, run `npm pack` in
`packages/qa-orchestrator-mcp` and `npm install --save-dev <path>/qa-orchestrator-mcp-0.1.0.tgz`.

## Install from npm (once published)

From the project root:

```bash
npm install --save-dev qa-orchestrator-mcp
npx qa-orchestrator-mcp init --api-url http://localhost:3100
```

`init` sets the project up for both editors. It keeps any servers already configured:

| File | For |
|---|---|
| `.mcp.json` | Claude Code (it asks you to approve the new project server once) |
| `.vscode/mcp.json` | VS Code (start it from **MCP: List Servers**) |
| `qa-orchestrator.config.json` | project settings (URLs, folders) |
| `.gitignore` | adds `.qa-orchestrator/` |

Commit those files and everyone who runs `npm install` gets the same server and version.
Options: `--claude` / `--vscode` (only one editor), `--ui-url <url>`, `--force` (replace an
existing `qa` entry and config), `--root <dir>`. See `npx qa-orchestrator-mcp init --help`.

The entries run `node node_modules/qa-orchestrator-mcp/dist/index.js`, which behaves the same
on Windows, macOS and Linux. If you run `init` without installing the package, it writes an
`npx -y qa-orchestrator-mcp` entry instead.

If the project already lists `@playwright/mcp` as a separate server, you can remove it: the
browser tools are built in.

The first time tests run on a machine, Playwright needs its browser: ask the agent to run
`qa_install_browsers`, or run `npx playwright install chromium`.

## Configure (optional)

Everything has a default. Override in `qa-orchestrator.config.json` at the project root:

```json
{
  "storiesDir": "user-stories",
  "outputDir": ".qa-orchestrator",
  "api": {
    "baseUrl": "http://localhost:3100",
    "openApiUrl": "http://localhost:3100/api-docs-json",
    "testsDir": "tests/api",
    "examples": { "number": "6E5321" }
  },
  "ui": {
    "baseUrl": "http://localhost:3000",
    "specsDir": "tests/specs",
    "pagesDir": "tests/pages",
    "fixturesFile": "tests/fixtures/test.fixture.ts",
    "dataDir": "tests/data"
  }
}
```

| Environment variable | Purpose |
|---|---|
| `QA_PROJECT_ROOT` | Project root (default: the directory the client starts the server in) |
| `API_BASE_URL`, `OPENAPI_URL`, `UI_BASE_URL` | Override the URLs above |
| `QA_BROWSER` | Browser for the browser tools: `chrome`, `msedge`, `firefox`, `webkit` |
| `QA_BROWSER_HEADLESS=1` | Run the browser tools headless |
| `QA_BROWSER_DISABLED=1` | Don't start the browser tools |
| `QA_PLAYWRIGHT_MCP_ARGS` | Extra flags for the built-in Playwright MCP |

Add `.qa-orchestrator/` to `.gitignore` unless you want review decisions and reports committed.

## User stories

Markdown files with an `## Acceptance Criteria` bullet list. API stories also need an
`## Implementation` section naming endpoints, e.g. `` `GET /api/items?id=42` ``. Example values
for query parameters come from `api.examples`, or from `` `name=value` `` spans in the story.

## Tools

| Tool | What it does |
|---|---|
| `qa_status` | Resolved config, Playwright location, browser install state |
| `qa_install_browsers` | Download Playwright's browser (only when you agree) |
| `qa_list_stories` | List user stories |
| `qa_api_plan` | Requirements → endpoints (OpenAPI) → test design → coverage gaps; writes a review packet |
| `qa_api_review` | Record **your** decision: approve, approve without some tests, or reject |
| `qa_api_run` | Full API pipeline; stops at the review gate until approved, then generates, runs, heals, reports |
| `qa_ui_analyze_story` | Extract and classify acceptance criteria |
| `qa_ui_save_test_cases` | Save the designed UI test cases (validated) |
| `qa_ui_scan_framework` | Find reusable page objects, fixtures and test data |
| `qa_ui_generate_spec` | Write stub tests (`TODO: [MCP-ENRICH]` + `test.fixme`) |
| `qa_ui_run_spec` | Run the spec with the project's own Playwright config |
| `qa_ui_classify_failures` / `qa_ui_update_failures` | Classify failures; record diagnoses |
| `qa_ui_heal_timing` | Fix timing failures automatically |
| `qa_ui_write_report` | Write the QA report |
| `qa_ui_get_context` | Full UI workflow state |
| `browser_*` | Playwright browser tools (navigate, click, type, snapshot, …) |

Prompts: `qa-api-workflow`, `qa-ui-workflow`, and the stage guides `qa-ui-test-design`,
`qa-ui-enrich-spec`, `qa-ui-failure-analysis`, `qa-ui-healing`.

## Human review

API test plans are reviewed by a person before any test is generated. If the client supports
MCP elicitation, `qa_api_run` asks you directly. Otherwise the agent shows you the plan and
records your answer with `qa_api_review`. The agent is instructed never to decide for you.
Each decision is tied to a hash of the plan: if the story or API changes, the plan is
reviewed again.

## Playwright

Tests run with the project's own `@playwright/test` when it has one, so the project's config,
fixtures and version apply. Projects without Playwright use the copy bundled here.

## Develop

```bash
npm install
npm run build      # tsc → dist/
npm publish        # runs the build first (prepublishOnly)
```
