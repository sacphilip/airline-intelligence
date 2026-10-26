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

// Generated specs never contain selectors: they use the page objects in tests/pages/, whose
// locators live in tests/locators/*.locators.json. No API mocks: tests run against the real backend.

// ── Detect primary tab from story content ────────────────────────────────────

function detectTab(storyContent: string): string {
  const s = storyContent.toLowerCase();
  if (/airline profile|airlines tab/.test(s)) return 'airline';
  if (/delays tab/.test(s))                   return 'delays';
  if (/live map|aircraft track/.test(s))      return 'map';
  return 'flight';
}

// ── Template per test case type ──────────────────────────────────────────────

// The `app` fixture has already opened '/'.
function buildTestBody(tc: any, tab: string): string[] {
  const lines: string[] = [];

  switch ((tc.type ?? 'Functional').toLowerCase()) {
    case 'negative':
      lines.push(`  await app.navigateTo('${tab}');`);
      lines.push(`  // TODO: [MCP-ENRICH] ${tc.scenario} — observe what error state renders`);
      lines.push(`  await app.expectActiveTab('${tab}');`);
      break;

    case 'ui':
      lines.push(`  await app.navigateTo('${tab}');`);
      lines.push(`  // TODO: [MCP-ENRICH] ${tc.scenario} — observe exact UI state and add assertions`);
      break;

    case 'state':
    case 'role':
      lines.push(`  // TODO: [MCP-ENRICH] ${tc.scenario} — test state transition or hash routing`);
      lines.push(`  await expect(app.page).toHaveURL('/');`);
      break;

    case 'boundary':
      lines.push(`  await app.navigateTo('${tab}');`);
      lines.push(`  // TODO: [MCP-ENRICH] ${tc.scenario} — test boundary values and observe validation`);
      break;

    default: // Functional
      lines.push(`  await app.navigateTo('${tab}');`);
      lines.push(`  // TODO: [MCP-ENRICH] ${tc.scenario} — navigate, interact and verify result`);
      lines.push(`  await app.expectActiveTab('${tab}');`);
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
  ` * Locators: add them to tests/locators/*.locators.json and use them through a page object.`,
  ` */`,
  `import { test, expect } from '../fixtures/test.fixture';`,
  ``,
  `test.describe('${storyId}', () => {`,
];

for (const tc of automatable) {
  lines.push(``);
  lines.push(`  // ${tc.requirement ?? ''} — ${tc.type ?? 'Functional'}`);
  lines.push(`  test(${JSON.stringify(`${tc.id}: ${tc.scenario}`)}, async ({ app }) => {`);
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
