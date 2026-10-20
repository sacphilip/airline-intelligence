import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { ProjectConfig, inProject, storyIdOf } from '../core/config';
import { log as out } from '../core/logger';
import { analyzeRequirements } from './agents/requirement-analyzer';
import { discoverApi } from './agents/api-discovery';
import { designTests } from './agents/test-designer';
import { generateTests } from './agents/test-generator';
import { analyzeFailures } from './agents/failure-analyzer';
import { healTests } from './agents/test-healer';
import { analyzePreTestCoverage, buildPostExecutionReport } from './agents/coverage-analyzer';
import { checkCoverageGate, coverageGatePacket } from './agents/coverage-gate';
import { ReviewOutcome, applyExclusions, reviewTestPlan } from './agents/human-review';
import { runTests } from './playwright/executor';
import { OrchestratorState } from './schemas/state';
import { writeGithubSummary } from './github-summary';

const log = (phase: string, message: string) => out(`[${phase}] ${message}`);

export const reviewDirOf = (cfg: ProjectConfig) => inProject(cfg, cfg.outputDir, 'review');

async function fetchOpenApiSchema(url: string): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`Could not reach the API at ${url} (${(err as Error).message}). Is the backend running? Set API_BASE_URL / OPENAPI_URL if it lives elsewhere.`);
  }
  if (!res.ok) throw new Error(`Failed to fetch OpenAPI schema from ${url}: ${res.status} ${res.statusText}`);
  return res.json() as Promise<Record<string, unknown>>;
}

/** Phases 1–4: requirements, API discovery, test design and pre-test coverage. No files are written. */
export async function planStory(cfg: ProjectConfig, storyPath: string): Promise<OrchestratorState> {
  const storyContent = readFileSync(storyPath, 'utf-8');
  const storyId = storyIdOf(storyPath);
  const state: OrchestratorState = { storyPath, storyContent, storyId, healAttempted: false };

  log('1/11 REQUIREMENTS', `Parsing ${storyId}…`);
  state.requirements = analyzeRequirements(storyContent, storyId);
  log('1/11 REQUIREMENTS', `Found ${state.requirements.requirements.length} requirements`);

  log('2/11 API DISCOVERY', `Fetching OpenAPI schema from ${cfg.api.openApiUrl}…`);
  const openApiSchema = await fetchOpenApiSchema(cfg.api.openApiUrl);
  state.apiContract = discoverApi(state.requirements, openApiSchema, storyContent, cfg.api.baseUrl);
  log('2/11 API DISCOVERY', `Mapped ${state.apiContract.endpoints.length} endpoints`);
  if (state.apiContract.endpoints.length === 0) {
    throw new Error('No API endpoints found for this story. Add a "## Implementation" section listing endpoints, e.g. `GET /api/items`.');
  }

  log('3/11 TEST DESIGN', 'Designing test cases…');
  state.testDesign = designTests(state.requirements, state.apiContract, storyContent, cfg.api.examples);
  log('3/11 TEST DESIGN', `Designed ${state.testDesign.testCases.length} test cases`);

  log('4/11 COVERAGE GAPS', 'Analysing coverage gaps before test generation…');
  state.preCoverage = analyzePreTestCoverage(state.requirements, state.testDesign);
  log('4/11 COVERAGE GAPS', `${state.preCoverage.coveragePercent}% requirement coverage — ${state.preCoverage.gaps.length} gap(s) identified`);
  for (const gap of state.preCoverage.gaps) log('4/11 COVERAGE GAPS', `  ⚠ [${gap.gapType}] ${gap.recommendation}`);

  // Phase 4b — Coverage gate: stop until a human approves the gap set
  const gateStatus = checkCoverageGate(reviewDirOf(cfg), storyId, state.preCoverage);
  if (gateStatus === 'awaiting') {
    state.stoppedAtCoverage = 'awaiting';
    log('4b/11 COVERAGE GATE', 'No coverage review decision yet. Stopping before plan review.');
    return state;
  }
  log('4b/11 COVERAGE GATE', 'Coverage approved — continuing to plan review.');
  return state;
}

/** Phase 5 against a planned story: the recorded decision, or a pending review packet. */
export function reviewPlannedStory(cfg: ProjectConfig, state: OrchestratorState, skip = false): ReviewOutcome {
  return reviewTestPlan({
    storyId: state.storyId,
    requirements: state.requirements!,
    design: state.testDesign!,
    coverage: state.preCoverage!,
    reviewDir: reviewDirOf(cfg),
    projectRoot: cfg.root,
    skip,
  });
}

export interface RunOptions {
  /** Skip the human review (recorded as auto-approved). */
  skipReview?: boolean;
}

/** The full pipeline. Stops at phase 5 unless the plan has been approved. */
export async function runApiOrchestrator(cfg: ProjectConfig, storyPath: string, options: RunOptions = {}): Promise<OrchestratorState> {
  const state = await planStory(cfg, storyPath);
  const { storyId } = state;

  // Phase 4b gate — stop if coverage hasn't been signed off
  if (state.stoppedAtCoverage === 'awaiting') {
    log('4b/11 COVERAGE GATE', 'Stopping at coverage gate — awaiting human review of gaps.');
    writeGithubSummary(state);
    return state;
  }

  // Phase 5 — Human review of the test plan (nothing is generated or run until approved)
  log('5/11 HUMAN REVIEW', options.skipReview ? 'Skipped (skipReview)' : 'Checking for a reviewer decision…');
  const outcome = reviewPlannedStory(cfg, state, options.skipReview);
  if (outcome.status === 'awaiting') {
    state.stoppedAtReview = 'awaiting';
    state.pendingReview = { reason: outcome.reason, packetPath: outcome.packetPath, decisionPath: outcome.decisionPath, packet: outcome.packet };
    log('5/11 HUMAN REVIEW', `${outcome.reason} Stopping before test generation.`);
    log('5/11 HUMAN REVIEW', `Review packet: ${outcome.packetPath}`);
    writeGithubSummary(state);
    return state;
  }

  state.review = outcome.record;
  if (state.review.decision === 'reject') {
    state.stoppedAtReview = 'rejected';
    log('5/11 HUMAN REVIEW', `Rejected by ${state.review.reviewer}: ${state.review.comment}`);
    log('RESULT', 'Test plan rejected — no tests generated. Update the story or test design and run again.');
    writeGithubSummary(state);
    return state;
  }
  if (state.review.excludedTestCaseIds.length > 0) {
    state.testDesign = applyExclusions(state.testDesign!, state.review.excludedTestCaseIds);
    state.preCoverage = analyzePreTestCoverage(state.requirements!, state.testDesign);
    log('5/11 HUMAN REVIEW', `Excluded ${state.review.excludedTestCaseIds.join(', ')} — coverage now ${state.preCoverage.coveragePercent}%`);
  }
  log('5/11 HUMAN REVIEW', `Approved by ${state.review.reviewer}${state.review.comment ? `: ${state.review.comment}` : ''}`);

  const design = state.testDesign!;
  const requirements = state.requirements!;
  const preGaps = state.preCoverage!.gaps;

  // Phase 6 — Test Generation (template-based TypeScript)
  log('6/11 TEST GENERATION', 'Generating Playwright test file…');
  const testSource = generateTests(design, state.apiContract!);
  const generatedDir = inProject(cfg, cfg.api.testsDir);
  mkdirSync(generatedDir, { recursive: true });
  const testFilePath = join(generatedDir, `${storyId.toLowerCase()}.spec.ts`);
  writeFileSync(testFilePath, testSource, 'utf-8');
  state.generatedTestPath = testFilePath;
  log('6/11 TEST GENERATION', `Written to ${testFilePath}`);

  // Phase 7 — First Execution
  log('7/11 FIRST RUN', 'Running tests…');
  state.firstRun = runTests(cfg, testFilePath);
  log('7/11 FIRST RUN', `${state.firstRun.passed}/${state.firstRun.total} passed`);

  const finish = () => {
    state.coverageReport = buildPostExecutionReport(requirements, design, state.finalRun!, preGaps);
    log('11/11 COVERAGE REPORT', `Coverage score: ${state.coverageReport.coverageScore}% — ${state.coverageReport.verdict}`);
    printSummary(state);
    writeGithubSummary(state);
    return state;
  };

  if (state.firstRun.failed === 0) {
    log('RESULT', 'All tests passed on first run.');
    state.finalRun = state.firstRun;
    return finish();
  }

  // Phase 8 — Failure Analysis (rule-based)
  log('8/11 ANALYSIS', `Analysing ${state.firstRun.failed} failure(s)…`);
  state.analysis = analyzeFailures(state.firstRun);
  const healableCount = state.analysis.failures.filter(f => f.healable).length;
  log('8/11 ANALYSIS', `${healableCount} healable, ${state.analysis.failures.length - healableCount} application bugs`);
  if (!state.analysis.anyHealable) {
    log('RESULT', 'No healable failures — review application bugs manually.');
    state.finalRun = state.firstRun;
    return finish();
  }

  // Phase 9 — Healing (pattern-based fixes)
  log('9/11 HEALING', 'Applying test fixes…');
  writeFileSync(testFilePath, healTests(testSource, state.analysis), 'utf-8');
  state.healAttempted = true;
  log('9/11 HEALING', 'Test file updated');

  // Phase 10 — Final Execution
  log('10/11 FINAL RUN', 'Re-running healed tests…');
  state.finalRun = runTests(cfg, testFilePath);
  log('10/11 FINAL RUN', `${state.finalRun.passed}/${state.finalRun.total} passed`);

  // Phase 11 — Post-execution Coverage Report
  return finish();
}

function printSummary(state: OrchestratorState): void {
  const run = state.finalRun ?? state.firstRun;
  if (!run) return;
  const lines: string[] = [];
  lines.push('═'.repeat(60), `  QA API Orchestrator — ${state.storyId}`, '═'.repeat(60));
  lines.push(`  Requirements:  ${state.requirements?.requirements.length ?? 0}`);
  lines.push(`  Test cases:    ${state.testDesign?.testCases.length ?? 0}`);
  lines.push(`  Passed:        ${run.passed} / ${run.total}`);
  lines.push(`  Failed:        ${run.failed}`);
  if (state.healAttempted) lines.push(`  Auto-healed:   ${(state.firstRun?.failed ?? 0) - run.failed}`);
  lines.push(`  Test file:     ${state.generatedTestPath}`);
  if (state.review) {
    const excluded = state.review.excludedTestCaseIds.length ? `, excluded ${state.review.excludedTestCaseIds.join(', ')}` : '';
    lines.push(`  Reviewed:      ${state.review.decision} by ${state.review.reviewer} (${state.review.mode})${excluded}`);
  }
  lines.push('═'.repeat(60));
  if (run.failed > 0) {
    lines.push('Remaining failures:');
    for (const f of run.failures) {
      const diagnosis = state.analysis?.failures.find(a => a.testTitle === f.title);
      lines.push(`  ✗ ${f.title}`, `    ${f.error.split('\n')[0]}`);
      if (diagnosis) lines.push(`    → ${diagnosis.category}: ${diagnosis.rootCause}`);
    }
  }
  const report = state.coverageReport;
  if (report) {
    lines.push('─'.repeat(60), `  Coverage Report — ${report.verdict}  (${report.coverageScore}%)`);
    for (const [cat, cov] of Object.entries(report.byCategory)) {
      if (cov.total > 0) lines.push(`  ${cat.padEnd(12)} ${cov.covered}/${cov.total} (${cov.percent}%)`);
    }
    for (const r of report.untestedRequirements) lines.push(`    ○ untested [${r.type}] ${r.description}`);
    for (const g of report.remainingGaps) lines.push(`    ⚠ ${g.recommendation}`);
  }
  out(lines.join('\n'));
}
