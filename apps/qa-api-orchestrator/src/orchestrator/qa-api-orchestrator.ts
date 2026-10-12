import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import { analyzeRequirements } from '../agents/requirement-analyzer';
import { discoverApi } from '../agents/api-discovery';
import { designTests } from '../agents/test-designer';
import { generateTests } from '../agents/test-generator';
import { analyzeFailures } from '../agents/failure-analyzer';
import { healTests } from '../agents/test-healer';
import { runTests } from '../playwright/executor';
import { OrchestratorState } from '../schemas/state';

const ROOT = join(__dirname, '../..');
const API_BASE = process.env.API_BASE_URL ?? 'http://localhost:3100';

function log(phase: string, message: string): void {
  console.log(`\n[${phase}] ${message}`);
}

async function fetchOpenApiSchema(): Promise<Record<string, unknown>> {
  const url = process.env.OPENAPI_URL ?? `${API_BASE}/api-docs-json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch OpenAPI schema from ${url}: ${res.status} ${res.statusText}`);
  return res.json() as Promise<Record<string, unknown>>;
}

function deriveStoryId(storyPath: string): string {
  const name = basename(storyPath, '.md');
  const match = name.match(/US-\d+/i);
  return match ? match[0].toUpperCase() : name.toUpperCase();
}

export async function runOrchestrator(storyPath: string): Promise<OrchestratorState> {
  const storyContent = readFileSync(storyPath, 'utf-8');
  const storyId = deriveStoryId(storyPath);

  const state: OrchestratorState = {
    storyPath,
    storyContent,
    storyId,
    healAttempted: false,
  };

  // Phase 1 — Requirements (deterministic markdown parse)
  log('1/8 REQUIREMENTS', `Parsing ${storyId}…`);
  state.requirements = analyzeRequirements(storyContent, storyId);
  log('1/8 REQUIREMENTS', `Found ${state.requirements.requirements.length} requirements`);

  // Phase 2 — API Discovery (OpenAPI schema fetch + parse)
  log('2/8 API DISCOVERY', `Fetching OpenAPI schema from ${process.env.OPENAPI_URL ?? `${API_BASE}/api-docs-json`}…`);
  const openApiSchema = await fetchOpenApiSchema();
  state.apiContract = discoverApi(state.requirements, openApiSchema, storyContent, API_BASE);
  log('2/8 API DISCOVERY', `Mapped ${state.apiContract.endpoints.length} endpoints`);

  if (state.apiContract.endpoints.length === 0) {
    throw new Error(
      'No API endpoints found for this story. ' +
      'Ensure the backend is running and the story has a "## Implementation" section with endpoint paths.',
    );
  }

  // Phase 3 — Test Design (rule-based)
  log('3/8 TEST DESIGN', 'Designing test cases…');
  state.testDesign = designTests(state.requirements, state.apiContract, storyContent);
  log('3/8 TEST DESIGN', `Designed ${state.testDesign.testCases.length} test cases`);

  // Phase 4 — Test Generation (template-based TypeScript)
  log('4/8 TEST GENERATION', 'Generating Playwright test file…');
  const testSource = generateTests(state.testDesign, state.apiContract);
  const generatedDir = join(ROOT, 'tests/generated');
  mkdirSync(generatedDir, { recursive: true });
  const testFileName = `${storyId.toLowerCase()}.spec.ts`;
  const testFilePath = join(generatedDir, testFileName);
  writeFileSync(testFilePath, testSource, 'utf-8');
  state.generatedTestPath = testFilePath;
  log('4/8 TEST GENERATION', `Written to ${testFilePath}`);

  // Phase 5 — First Execution
  log('5/8 FIRST RUN', 'Running tests…');
  state.firstRun = runTests(testFilePath);
  log('5/8 FIRST RUN', `${state.firstRun.passed}/${state.firstRun.total} passed`);

  if (state.firstRun.failed === 0) {
    log('RESULT', 'All tests passed on first run.');
    state.finalRun = state.firstRun;
    printSummary(state);
    return state;
  }

  // Phase 6 — Failure Analysis (rule-based)
  log('6/8 ANALYSIS', `Analysing ${state.firstRun.failed} failure(s)…`);
  state.analysis = analyzeFailures(state.firstRun);
  const healableCount = state.analysis.failures.filter(f => f.healable).length;
  log('6/8 ANALYSIS', `${healableCount} healable, ${state.analysis.failures.length - healableCount} application bugs`);

  if (!state.analysis.anyHealable) {
    log('RESULT', 'No healable failures — review application bugs manually.');
    state.finalRun = state.firstRun;
    printSummary(state);
    return state;
  }

  // Phase 7 — Healing (pattern-based fixes)
  log('7/8 HEALING', 'Applying test fixes…');
  const healed = healTests(testSource, state.analysis);
  writeFileSync(testFilePath, healed, 'utf-8');
  state.healAttempted = true;
  log('7/8 HEALING', 'Test file updated');

  // Phase 8 — Final Execution
  log('8/8 FINAL RUN', 'Re-running healed tests…');
  state.finalRun = runTests(testFilePath);
  log('8/8 FINAL RUN', `${state.finalRun.passed}/${state.finalRun.total} passed`);

  printSummary(state);
  return state;
}

function printSummary(state: OrchestratorState): void {
  const run = state.finalRun ?? state.firstRun;
  if (!run) return;

  console.log('\n' + '═'.repeat(60));
  console.log(`  QA API Orchestrator — ${state.storyId}`);
  console.log('═'.repeat(60));
  console.log(`  Requirements:  ${state.requirements?.requirements.length ?? 0}`);
  console.log(`  Test cases:    ${state.testDesign?.testCases.length ?? 0}`);
  console.log(`  Passed:        ${run.passed} / ${run.total}`);
  console.log(`  Failed:        ${run.failed}`);
  if (state.healAttempted) {
    const fixed = (state.firstRun?.failed ?? 0) - run.failed;
    console.log(`  Auto-healed:   ${fixed}`);
  }
  console.log(`  Test file:     ${state.generatedTestPath}`);
  console.log('═'.repeat(60) + '\n');

  if (run.failed > 0) {
    console.log('Remaining failures:');
    for (const f of run.failures) {
      const diagnosis = state.analysis?.failures.find(a => a.testTitle === f.title);
      console.log(`  ✗ ${f.title}`);
      console.log(`    ${f.error.split('\n')[0]}`);
      if (diagnosis) console.log(`    → ${diagnosis.category}: ${diagnosis.rootCause}`);
    }
    console.log('');
  }
}
