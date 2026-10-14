#!/usr/bin/env node
/**
 * Stage 3 — Framework Scanner (deterministic)
 * Inventories existing pages, fixtures, mock data and specs so the
 * Automation Agent knows what to reuse.
 * Run from apps/qa-ui-orchestrator/:
 *   npx tsx scripts/framework-scanner.ts
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join, basename, resolve } from 'path';

const ORCH_DIR     = resolve(process.cwd());
const PROJECT_ROOT = resolve(ORCH_DIR, '../..');
const CTX          = join(ORCH_DIR, 'workflows/execution-context.json');

function files(dir: string, ext: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith(ext));
}

function exportedNames(filePath: string): string[] {
  if (!existsSync(filePath)) return [];
  const src = readFileSync(filePath, 'utf-8');
  return [...src.matchAll(/export\s+(?:const|class|function|type|interface)\s+(\w+)/g)]
    .map(m => m[1]);
}

function classNames(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return files(dir, '.ts')
    .map(f => {
      const src = readFileSync(join(dir, f), 'utf-8');
      const m = src.match(/export\s+class\s+(\w+)/);
      return m ? m[1] : basename(f, '.ts');
    });
}

const pagesDir    = join(PROJECT_ROOT, 'tests/pages');
const fixtureFile = join(PROJECT_ROOT, 'tests/fixtures/test.fixture.ts');
const dataDir     = join(PROJECT_ROOT, 'tests/data');
const specsDir    = join(PROJECT_ROOT, 'tests/specs');

const pages    = classNames(pagesDir);
const fixtures = exportedNames(fixtureFile).filter(n => !['test', 'expect', 'base'].includes(n));
const mockData = files(dataDir, '.ts').flatMap(f => exportedNames(join(dataDir, f)));
const specs    = files(specsDir, '.spec.ts');

const ctx = JSON.parse(readFileSync(CTX, 'utf-8'));
const storyNum = (ctx.storyId ?? 'US-000').replace(/^US-/i, '').toLowerCase();

const specExists = specs.find(s =>
  s.toLowerCase().startsWith(`us-${storyNum}-`) || s === `us-${storyNum}.spec.ts`,
) ?? null;

const reusable: string[] = [];
if (pages.includes('AppPage'))          reusable.push('AppPage — tab navigation, hash routing (tests/pages/AppPage.ts)');
if (pages.includes('FlightSearchPage')) reusable.push('FlightSearchPage — number/route search (tests/pages/FlightSearchPage.ts)');
if (pages.includes('AirlinePage'))      reusable.push('AirlinePage — airline profile lookup (tests/pages/AirlinePage.ts)');
if (mockData.includes('TEST_DATA'))     reusable.push('TEST_DATA — standard test inputs (tests/data/test-data.ts)');
if (fixtures.includes('app'))           reusable.push('app fixture (tests/fixtures/test.fixture.ts)');
if (fixtures.includes('flightSearch'))  reusable.push('flightSearch fixture (tests/fixtures/test.fixture.ts)');
if (fixtures.includes('airlinePage'))   reusable.push('airlinePage fixture (tests/fixtures/test.fixture.ts)');

ctx.frameworkDiscovery = {
  existingPages:        pages.map(p => `${p} (tests/pages/${p}.ts)`),
  existingFixtures:     fixtures.map(f => `${f} fixture`),
  existingMockData:     mockData,
  existingSpecs:        specs,
  specAlreadyExists:    specExists,
  reusableForNewStory:  reusable,
};
ctx.status = 'FRAMEWORK_DISCOVERED';

writeFileSync(CTX, JSON.stringify(ctx, null, 2));

console.log(`\n[framework-scanner] Discovered framework for ${ctx.storyId}\n`);
console.log(`  Pages:    ${pages.join(', ')}`);
console.log(`  Fixtures: ${fixtures.join(', ')}`);
console.log(`  Specs:    ${specs.length} existing`);
if (specExists) console.log(`  ⚠ Spec already exists: ${specExists}`);
console.log(`\n  Reusable for this story:`);
reusable.forEach(r => console.log(`    ✓ ${r}`));
