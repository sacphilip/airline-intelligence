#!/usr/bin/env node
/**
 * Stage 4a — UI Test Generator (deterministic)
 * Generates a base Playwright spec from testCases[] in execution-context.json.
 * Every test stub includes a // TODO: [MCP-ENRICH] comment so the Playwright MCP
 * enrichment step knows exactly what assertions to add.
 * Run from apps/qa-ui-orchestrator/:
 *   npx tsx scripts/ui-test-generator.ts
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';

const ORCH_DIR     = resolve(process.cwd());
const PROJECT_ROOT = resolve(ORCH_DIR, '../..');
const CTX          = join(ORCH_DIR, 'workflows/execution-context.json');

// ── Locator table (from agents/automation-agent.md) ──────────────────────────

const LOCATORS: Record<string, string> = {
  tabFlight:      `page.getByRole('button', { name: /Find Flight/i })`,
  tabAirline:     `page.getByRole('button', { name: /Airlines/i })`,
  tabDelays:      `page.getByRole('button', { name: /Delays/i })`,
  tabMap:         `page.getByRole('button', { name: /Live Map/i })`,
  flightNumInput: `page.getByPlaceholder(/6E 5321/i)`,
  fromInput:      `page.getByPlaceholder('From (BLR)')`,
  toInput:        `page.getByPlaceholder('To (DEL)')`,
  dateInput:      `page.locator('input[type="date"]').first()`,
  searchButton:   `page.getByRole('button', { name: 'Search' })`,
  iataInput:      `page.getByPlaceholder(/IATA code/i)`,
  errorBanner:    `page.locator('[class*="destructive"]')`,
  historyToggle:  `page.getByRole('button', { name: /Flight history/i })`,
};

// ── API mock setup ────────────────────────────────────────────────────────────

const MOCK_SETUP = `
async function mockApi(page: Page): Promise<void> {
  await page.route('**/api/search**',           r => r.fulfill({ status: 200, json: { legs: [] } }));
  await page.route('**/api/route/**',            r => r.fulfill({ status: 200, json: {} }));
  await page.route('**/api/flight/history**',    r => r.fulfill({ status: 200, json: { flights: [] } }));
  await page.route('**/api/airline/profile**',   r => r.fulfill({ status: 200, json: {} }));
  await page.route('**/api/airline/rankings**',  r => r.fulfill({ status: 200, json: [] }));
  await page.route('**/api/delays/**',           r => r.fulfill({ status: 200, json: [] }));
}
`.trim();

// ── Detect primary tab from story content ────────────────────────────────────

function detectTab(storyContent: string): string {
  const s = storyContent.toLowerCase();
  if (/airline profile|airlines tab/.test(s)) return 'airline';
  if (/delays tab/.test(s))                   return 'delays';
  if (/live map|aircraft track/.test(s))      return 'map';
  return 'flight';
}

// ── Template per test case type ──────────────────────────────────────────────

function buildTestBody(tc: any, tab: string): string[] {
  const lines: string[] = [];
  const tabLabel = tab === 'airline' ? 'Airlines' : tab === 'delays' ? 'Delays' : tab === 'map' ? 'Live Map' : 'Find Flight';

  switch ((tc.type ?? 'Functional').toLowerCase()) {
    case 'negative':
      lines.push(`  await mockApi(page);`);
      lines.push(`  await page.goto('/');`);
      lines.push(`  await page.getByRole('button', { name: '${tabLabel}' }).click();`);
      lines.push(`  // TODO: [MCP-ENRICH] ${tc.scenario} — observe what error state renders`);
      lines.push(`  await expect(page.getByRole('button', { name: '${tabLabel}' })).toBeVisible();`);
      break;

    case 'ui':
      lines.push(`  await mockApi(page);`);
      lines.push(`  await page.goto('/');`);
      lines.push(`  await page.getByRole('button', { name: '${tabLabel}' }).click();`);
      lines.push(`  // TODO: [MCP-ENRICH] ${tc.scenario} — observe exact UI state and add assertions`);
      break;

    case 'state':
    case 'role':
      lines.push(`  await mockApi(page);`);
      lines.push(`  await page.goto('/');`);
      lines.push(`  // TODO: [MCP-ENRICH] ${tc.scenario} — test state transition or hash routing`);
      lines.push(`  await expect(page).toHaveURL('/');`);
      break;

    case 'boundary':
      lines.push(`  await mockApi(page);`);
      lines.push(`  await page.goto('/');`);
      lines.push(`  await page.getByRole('button', { name: '${tabLabel}' }).click();`);
      lines.push(`  // TODO: [MCP-ENRICH] ${tc.scenario} — test boundary values and observe validation`);
      break;

    default: // Functional
      lines.push(`  await mockApi(page);`);
      lines.push(`  await page.goto('/');`);
      lines.push(`  await page.getByRole('button', { name: '${tabLabel}' }).click();`);
      lines.push(`  // TODO: [MCP-ENRICH] ${tc.scenario} — navigate, interact and verify result`);
      lines.push(`  await expect(page.getByRole('button', { name: '${tabLabel}' })).toBeVisible();`);
  }
  return lines;
}

// ── Main ─────────────────────────────────────────────────────────────────────

const ctx = JSON.parse(readFileSync(CTX, 'utf-8'));
const { storyId, storyFile, testCases } = ctx;

if (!testCases?.length) {
  console.error('[ui-test-generator] No testCases in execution-context.json. Run test-design stage first.');
  process.exit(1);
}

// Resolve storyFile relative to PROJECT_ROOT if not absolute
const absStoryFile = storyFile
  ? (storyFile.includes(':') || storyFile.startsWith('/') ? storyFile : join(PROJECT_ROOT, storyFile))
  : '';

const storyContent = absStoryFile && existsSync(absStoryFile) ? readFileSync(absStoryFile, 'utf-8') : '';
const tab = detectTab(storyContent);

const slug = (storyFile as string)
  .replace(/\\/g, '/')
  .split('/')
  .pop()!
  .replace(/^US-\d+-?/i, '')
  .replace(/\.md$/, '')
  .toLowerCase()
  .replace(/\s+/g, '-');

const storyNum = storyId.replace(/^US-/i, '').toLowerCase();
const specFile = join(PROJECT_ROOT, `tests/specs/us-${storyNum}-${slug}.spec.ts`);

const automatable = testCases.filter((tc: any) => tc.automation !== false);
const lines: string[] = [
  `/**`,
  ` * ${storyId} — generated base spec`,
  ` * Deterministic scaffold — enrich with Playwright MCP (look for TODO: [MCP-ENRICH])`,
  ` */`,
  `import { test, expect, Page } from '@playwright/test';`,
  ``,
  MOCK_SETUP,
  ``,
  `test.describe('${storyId}', () => {`,
];

for (const tc of automatable) {
  lines.push(``);
  lines.push(`  // ${tc.requirement ?? ''} — ${tc.type ?? 'Functional'}`);
  lines.push(`  test(${JSON.stringify(`${tc.id}: ${tc.scenario}`)}, async ({ page }) => {`);
  for (const bl of buildTestBody(tc, tab)) lines.push(bl);
  lines.push(`  });`);
}

lines.push(`});`, ``);

mkdirSync(join(PROJECT_ROOT, 'tests/specs'), { recursive: true });
writeFileSync(specFile, lines.join('\n'), 'utf-8');

ctx.automatedTests = automatable.map((tc: any) => ({
  testCaseId: tc.id,
  file: `tests/specs/us-${storyNum}-${slug}.spec.ts`,
  status: 'created',
}));
ctx.status = 'AUTOMATION_DONE';
writeFileSync(CTX, JSON.stringify(ctx, null, 2));

console.log(`\n[ui-test-generator] ${storyId} — ${automatable.length} test stub(s) written`);
console.log(`  File: ${specFile}`);
console.log(`  Tab:  ${tab}`);
console.log(`\n  Next: Playwright MCP enrichment — search for TODO: [MCP-ENRICH] in the spec`);
