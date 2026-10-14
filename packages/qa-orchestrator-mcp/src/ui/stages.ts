import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, dirname, join, relative } from 'path';
import { ProjectConfig, inProject, storyIdOf } from '../core/config';
import { flattenReport, runPlaywright } from '../core/playwright';
import {
  FailureClassification, UiContext, UiRequirement, UiRequirementType, UiTestCase,
  loadContext, reportPath, saveContext,
} from './context';

// The UI orchestrator's deterministic stages. The judgement stages (test design,
// enriching generated stubs in a real browser, diagnosing UNKNOWN failures, healing
// locators) are done by the agent, guided by the MCP prompts and the browser tools.

const posix = (p: string) => p.replace(/\\/g, '/');

// ── Stage 1 — Requirements ────────────────────────────────────────────────────

function classify(line: string): UiRequirementType {
  const l = line.toLowerCase();
  if (/invalid|error|missing|reject|fail|not found|empty result|no match|404/.test(l)) return 'negative';
  if (/loading|spinner|indicator|visible|hidden|toggle|expand|collapse|banner|badge|state/.test(l)) return 'ui';
  if (/hash|routing|navigate|redirect|pre.?fill|auto.?search|link|click.*tab|tab.*click/.test(l)) return 'state';
  if (/format|validat|boundary|min|max|length|pattern|at least|at most/.test(l)) return 'boundary';
  return 'functional';
}

export function analyzeStory(cfg: ProjectConfig, storyPath: string): UiContext {
  const content = readFileSync(storyPath, 'utf-8');
  const lines = content.split('\n');
  const storyId = storyIdOf(storyPath);

  const start = lines.findIndex(l => /^##\s+acceptance criteria/i.test(l));
  if (start === -1) throw new Error(`No "## Acceptance Criteria" section found in ${storyPath}`);
  const end = lines.findIndex((l, i) => i > start && /^##/.test(l));
  const bullets = lines.slice(start + 1, end === -1 ? undefined : end).filter(l => /^\s*[-*]/.test(l));

  const requirements: UiRequirement[] = bullets.map((line, i) => ({
    id: `AC-${String(i + 1).padStart(2, '0')}`,
    description: line.replace(/^\s*[-*]\s*/, '').trim(),
    type: classify(line),
  }));
  if (!requirements.some(r => r.type === 'negative')) {
    requirements.push({ id: 'NEG-01', description: 'Invalid or missing input returns an appropriate error state', type: 'negative' });
  }

  const ctx: UiContext = {
    storyId, storyFile: posix(relative(cfg.root, storyPath)), status: 'REQUIREMENTS_DONE', requirements,
    testCases: [], frameworkDiscovery: {}, automatedTests: [], executionResults: [], failures: [], healingAttempts: [], defects: [],
  };
  saveContext(cfg, ctx);
  return ctx;
}

// ── Stage 2 — Test design (the agent designs; this validates and stores) ───────

export function saveTestCases(cfg: ProjectConfig, storyId: string, testCases: UiTestCase[]): UiContext {
  const ctx = loadContext(cfg, storyId);
  const reqIds = new Set(ctx.requirements.map(r => r.id));
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const tc of testCases) {
    if (seen.has(tc.id)) problems.push(`duplicate test case id ${tc.id}`);
    seen.add(tc.id);
    if (!reqIds.has(tc.requirement)) problems.push(`${tc.id} references unknown requirement "${tc.requirement}"`);
  }
  const uncovered = ctx.requirements.filter(r => !testCases.some(tc => tc.requirement === r.id)).map(r => r.id);
  if (problems.length) throw new Error(`Test cases not saved: ${problems.join('; ')}`);

  ctx.testCases = testCases;
  ctx.status = 'TEST_DESIGN_DONE';
  saveContext(cfg, ctx);
  if (uncovered.length) (ctx as UiContext & { warnings?: string[] }).warnings = [`No test case covers: ${uncovered.join(', ')}`];
  return ctx;
}

// ── Stage 3 — Framework discovery ─────────────────────────────────────────────

function filesIn(dir: string, ext: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith(ext)) : [];
}

function exportedNames(file: string): string[] {
  if (!existsSync(file)) return [];
  return [...readFileSync(file, 'utf-8').matchAll(/export\s+(?:const|class|function|type|interface)\s+(\w+)/g)].map(m => m[1]);
}

/** Fixture names declared in `base.extend<…>({ name: async (…) => … })`. */
function fixtureNames(file: string): string[] {
  if (!existsSync(file)) return [];
  const src = readFileSync(file, 'utf-8');
  const block = src.match(/\.extend\s*<[^>]*>\s*\(\s*\{([\s\S]*)\}\s*\)/)?.[1] ?? '';
  return [...block.matchAll(/^\s*(\w+)\s*:\s*async/gm)].map(m => m[1]);
}

export function scanFramework(cfg: ProjectConfig, storyId: string): UiContext {
  const ctx = loadContext(cfg, storyId);
  const pagesDir = inProject(cfg, cfg.ui.pagesDir);
  const fixtureFile = inProject(cfg, cfg.ui.fixturesFile);
  const dataDir = inProject(cfg, cfg.ui.dataDir);
  const specsDir = inProject(cfg, cfg.ui.specsDir);

  const pages = filesIn(pagesDir, '.ts').map(f => {
    const cls = readFileSync(join(pagesDir, f), 'utf-8').match(/export\s+class\s+(\w+)/)?.[1] ?? basename(f, '.ts');
    return { name: cls, file: posix(join(cfg.ui.pagesDir, f)) };
  });
  const fixtures = fixtureNames(fixtureFile);
  const data = filesIn(dataDir, '.ts').flatMap(f => exportedNames(join(dataDir, f)).map(n => ({ name: n, file: posix(join(cfg.ui.dataDir, f)) })));
  const specs = filesIn(specsDir, '.spec.ts');
  const num = storyId.replace(/^US-/i, '').toLowerCase();
  const specExists = specs.find(s => s.toLowerCase().startsWith(`us-${num}-`) || s === `us-${num}.spec.ts`) ?? null;

  ctx.frameworkDiscovery = {
    existingPages: pages.map(p => `${p.name} (${p.file})`),
    existingFixtures: fixtures.map(f => `${f} fixture (${cfg.ui.fixturesFile})`),
    existingData: data.map(d => `${d.name} (${d.file})`),
    existingSpecs: specs,
    specAlreadyExists: specExists,
    fixtureFile: existsSync(fixtureFile) ? cfg.ui.fixturesFile : null,
    reusableForNewStory: [
      ...pages.map(p => `${p.name} — page object (${p.file})`),
      ...fixtures.map(f => `${f} — fixture (${cfg.ui.fixturesFile})`),
      ...data.map(d => `${d.name} — test data (${d.file})`),
    ],
  };
  ctx.status = 'FRAMEWORK_DISCOVERED';
  saveContext(cfg, ctx);
  return ctx;
}

// ── Stage 4a — Base spec generation ───────────────────────────────────────────

function slugOf(storyFile: string): string {
  return basename(storyFile, '.md').replace(/^US-\d+-?/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'story';
}

/** Generic stubs: navigate, then a TODO the agent fills in from what it observes in the browser. */
function stubBody(tc: UiTestCase): string[] {
  const steps = (tc.steps ?? []).map(s => `    //   - ${s}`);
  return [
    `    await page.goto('/');`,
    `    // TODO: [MCP-ENRICH] ${tc.scenario}`,
    ...(steps.length ? ['    // Steps:', ...steps] : []),
    ...(tc.expected ? [`    // Expected: ${tc.expected}`] : []),
    `    test.fixme(true, 'Not enriched yet: replace the TODO with real interactions and assertions');`,
  ];
}

export function generateSpec(cfg: ProjectConfig, storyId: string, overwrite = false): UiContext & { specFile: string } {
  const ctx = loadContext(cfg, storyId);
  const cases = ctx.testCases.filter(tc => tc.automation !== false);
  if (!cases.length) throw new Error('No automatable test cases. Save the test design with qa_ui_save_test_cases first.');

  const num = storyId.replace(/^US-/i, '').toLowerCase();
  const relSpec = posix(join(cfg.ui.specsDir, `us-${num}-${slugOf(ctx.storyFile)}.spec.ts`));
  const specFile = inProject(cfg, relSpec);
  if (existsSync(specFile) && !overwrite) {
    throw new Error(`${relSpec} already exists. Extend it by hand, or pass overwrite: true to regenerate the stubs.`);
  }

  // Reuse the project's own fixtures (and its `test`) when it has a fixture file.
  const fixtureAbs = inProject(cfg, cfg.ui.fixturesFile);
  const usesFixture = existsSync(fixtureAbs) && /export\s+(?:const\s+test|\{[^}]*\btest\b)/.test(readFileSync(fixtureAbs, 'utf-8'));
  const importFrom = usesFixture
    ? posix(relative(dirname(specFile), fixtureAbs)).replace(/\.ts$/, '').replace(/^(?!\.)/, './')
    : '@playwright/test';

  const lines = [
    '/**',
    ` * ${storyId} — generated by qa-orchestrator-mcp`,
    ' * Each test is a stub marked TODO: [MCP-ENRICH] and test.fixme until enriched in a real browser.',
    ' */',
    `import { test, expect } from '${importFrom}';`,
    '',
    `test.describe('${storyId}', () => {`,
  ];
  for (const tc of cases) {
    lines.push('', `  // ${tc.requirement} — ${tc.type ?? 'Functional'}${tc.priority ? ` · ${tc.priority}` : ''}`);
    lines.push(`  test(${JSON.stringify(`${tc.id}: ${tc.scenario}`)}, async ({ page }) => {`, ...stubBody(tc), '  });');
  }
  lines.push('});', '', '// Keeps `expect` referenced until the stubs are enriched.', 'void expect;', '');

  mkdirSync(dirname(specFile), { recursive: true });
  writeFileSync(specFile, lines.join('\n'), 'utf-8');

  ctx.automatedTests = cases.map(tc => ({ testCaseId: tc.id, file: relSpec, status: 'created' as const }));
  ctx.status = 'AUTOMATION_DONE';
  saveContext(cfg, ctx);
  return { ...ctx, specFile };
}

// ── Stage 5 / 8 — Execution ───────────────────────────────────────────────────

export function executeSpec(cfg: ProjectConfig, storyId: string): UiContext & { output: string } {
  const ctx = loadContext(cfg, storyId);
  const files = [...new Set(ctx.automatedTests.map(t => t.file))];
  if (!files.length) throw new Error('No generated spec for this story. Run qa_ui_generate_spec first.');

  const reportFile = inProject(cfg, cfg.outputDir, 'ui', `${storyId}.results.json`);
  // The project's own playwright.config is used, so its webServer, baseURL and projects apply.
  const run = runPlaywright({ root: cfg.root, files, reportFile });
  if (!run.report) {
    ctx.status = 'BLOCKED';
    ctx.executionResults = [];
    saveContext(cfg, ctx);
    return { ...ctx, output: run.output.slice(-6000) };
  }

  ctx.executionResults = flattenReport(run.report).map(t => {
    const testId = t.title.match(/^(TC-[\w-]+?):/)?.[1] ?? t.title;
    const shot = t.attachments.find(a => a.name === 'screenshot')?.path;
    const trace = t.attachments.find(a => a.name === 'trace')?.path;
    return {
      testId,
      result: t.status === 'passed' ? 'PASS' as const : t.status === 'skipped' ? 'SKIP' as const : 'FAIL' as const,
      duration: t.duration,
      ...(t.error ? { error: t.error.split('\n').slice(0, 12).join('\n') } : {}),
      ...(shot ? { screenshot: shot } : {}),
      ...(trace ? { trace } : {}),
    };
  });
  ctx.status = ctx.executionResults.some(r => r.result === 'FAIL') ? 'FAIL' : 'PASS';
  saveContext(cfg, ctx);
  return { ...ctx, output: run.output.slice(-3000) };
}

// ── Stage 6a — Failure classification ─────────────────────────────────────────

const PATTERNS: { regex: RegExp; classification: FailureClassification; action: 'HEAL' | 'REPORT_DEFECT' | 'INVESTIGATE'; cause: string }[] = [
  { regex: /ECONNREFUSED|ENOTFOUND|connect ETIMEDOUT|net::ERR_CONNECTION/i, classification: 'ENVIRONMENT_FAILURE', action: 'INVESTIGATE', cause: 'A server the test needs is not running or not reachable' },
  { regex: /Executable doesn't exist|playwright install/i, classification: 'ENVIRONMENT_FAILURE', action: 'INVESTIGATE', cause: 'Playwright browser not installed — run the qa_install_browsers tool' },
  { regex: /timeout.*exceeded|waiting for.*locator|locator.*timed out/i, classification: 'TIMING_SYNCHRONIZATION', action: 'HEAL', cause: 'Element not ready within the timeout' },
  { regex: /strict mode violation|resolved to (\d+) element/i, classification: 'LOCATOR_FAILURE', action: 'HEAL', cause: 'Locator matched several elements (strict mode)' },
  { regex: /element not found|no element matching|locator\.(\w+): element is not/i, classification: 'LOCATOR_FAILURE', action: 'HEAL', cause: 'Element not found in the DOM' },
  { regex: /Expected.*toHaveText.*Received|Expected.*toContainText.*Received/i, classification: 'TEST_DATA_FAILURE', action: 'HEAL', cause: 'Rendered text differs from what the test expects' },
  { regex: /Expected.*toHaveURL.*Received|Expected.*toHaveAttribute.*Received/i, classification: 'TEST_DEFECT', action: 'HEAL', cause: 'URL or attribute assertion mismatch' },
  { regex: /status code (\d{3})|expected.*status.*(\d{3}).*received.*(\d{3})/i, classification: 'PRODUCT_DEFECT', action: 'REPORT_DEFECT', cause: 'Unexpected HTTP status' },
  { regex: /Cannot read propert|TypeError:|undefined is not/i, classification: 'TEST_DEFECT', action: 'HEAL', cause: 'Null/undefined reference in the test' },
];

export function classifyFailures(cfg: ProjectConfig, storyId: string): UiContext {
  const ctx = loadContext(cfg, storyId);
  ctx.failures = ctx.executionResults.filter(r => r.result === 'FAIL').map(r => {
    const error = r.error ?? '';
    const hit = PATTERNS.map(p => ({ p, m: error.match(p.regex) })).find(x => x.m);
    return hit
      ? { testId: r.testId, classification: hit.p.classification, rootCause: `${hit.p.cause}: ${hit.m![0].slice(0, 120)}`, evidence: error.split('\n')[0].slice(0, 200), action: hit.p.action }
      : { testId: r.testId, classification: 'UNKNOWN' as const, rootCause: 'Could not pattern-match the error — inspect the screenshot/trace', evidence: error.split('\n')[0].slice(0, 200), action: 'INVESTIGATE' as const };
  });
  saveContext(cfg, ctx);
  return ctx;
}

// ── Stage 7a — Deterministic healing (timing only) ────────────────────────────

function healTiming(src: string): { healed: string; changes: string[] } {
  const changes: string[] = [];
  let healed = src;
  if (/\.toBeVisible\(\s*\)/.test(healed)) { healed = healed.replace(/\.toBeVisible\(\s*\)/g, '.toBeVisible({ timeout: 10_000 })'); changes.push('toBeVisible() → toBeVisible({ timeout: 10_000 })'); }
  if (/\.toBeHidden\(\s*\)/.test(healed)) { healed = healed.replace(/\.toBeHidden\(\s*\)/g, '.toBeHidden({ timeout: 10_000 })'); changes.push('toBeHidden() → toBeHidden({ timeout: 10_000 })'); }
  if (/await page\.waitForTimeout\(\d+\)/.test(healed)) { healed = healed.replace(/await page\.waitForTimeout\(\d+\);?\n?/g, ''); changes.push('Removed arbitrary waitForTimeout()'); }
  return { healed, changes };
}

export const MAX_HEAL_ATTEMPTS = 2;

export function healTimingFailures(cfg: ProjectConfig, storyId: string): UiContext & { needsAgent: string[] } {
  const ctx = loadContext(cfg, storyId);
  const attemptsFor = (id: string) => ctx.healingAttempts.filter(h => h.testId === id).length;
  const timing = ctx.failures.filter(f => f.action === 'HEAL' && f.classification === 'TIMING_SYNCHRONIZATION');
  const needsAgent = ctx.failures.filter(f => f.action === 'HEAL' && f.classification !== 'TIMING_SYNCHRONIZATION').map(f => f.testId);

  const byFile = new Map<string, string[]>();
  for (const f of timing) {
    if (attemptsFor(f.testId) >= MAX_HEAL_ATTEMPTS) continue;
    const file = ctx.automatedTests.find(t => t.testCaseId === f.testId)?.file;
    if (file) byFile.set(file, [...(byFile.get(file) ?? []), f.testId]);
  }
  for (const [rel, ids] of byFile) {
    const file = inProject(cfg, rel);
    if (!existsSync(file)) continue;
    const { healed, changes } = healTiming(readFileSync(file, 'utf-8'));
    if (!changes.length) { needsAgent.push(...ids); continue; }
    writeFileSync(file, healed, 'utf-8');
    for (const testId of ids) {
      ctx.healingAttempts.push({ testId, attempt: attemptsFor(testId) + 1, change: changes.join('; '), reason: 'TIMING_SYNCHRONIZATION — explicit assertion timeouts', result: 'PENDING' });
    }
  }
  for (const testId of needsAgent) {
    if (!ctx.healingAttempts.some(h => h.testId === testId && h.result === 'NEEDS_LLM')) {
      ctx.healingAttempts.push({ testId, attempt: attemptsFor(testId) + 1, change: '', reason: 'Needs agent healing (locator / data / test logic)', result: 'NEEDS_LLM' });
    }
  }
  saveContext(cfg, ctx);
  return { ...ctx, needsAgent };
}

// ── Stage 9 — Report ──────────────────────────────────────────────────────────

export function writeReport(cfg: ProjectConfig, storyId: string): { status: string; reportFile: string; report: string } {
  const ctx = loadContext(cfg, storyId);
  const { requirements, testCases, executionResults: res, failures, healingAttempts, automatedTests, frameworkDiscovery } = ctx;
  const total = res.length;
  const passed = res.filter(r => r.result === 'PASS').length;
  const failed = res.filter(r => r.result === 'FAIL').length;
  const skipped = res.filter(r => r.result === 'SKIP').length;
  const dur = res.reduce((s, r) => s + (r.duration ?? 0), 0);
  const defects = failures.filter(f => f.classification === 'PRODUCT_DEFECT');
  const uncovered = requirements.filter(r => !testCases.some(tc => tc.requirement === r.id));

  const status = total === 0 ? 'BLOCKED'
    : failed > 0 || defects.length ? 'FAIL'
    : uncovered.length || skipped > 0 ? 'PASS WITH RISKS'
    : 'PASS';
  const icon = { PASS: '✅', 'PASS WITH RISKS': '⚠️', BLOCKED: '🚫', FAIL: '❌' }[status];
  const reqCounts: Record<string, number> = {};
  for (const r of requirements) reqCounts[r.type] = (reqCounts[r.type] ?? 0) + 1;

  const coverage = testCases.length
    ? ['| TC ID | Scenario | Type | Priority | Result |', '|-------|----------|------|----------|--------|',
      ...testCases.map(tc => {
        const r = res.find(x => x.testId === tc.id);
        const result = !r ? '⏳ Not run' : r.result === 'PASS' ? '✅ PASS' : r.result === 'FAIL' ? '❌ FAIL' : '⏭ SKIP';
        return `| ${tc.id} | ${tc.scenario} | ${tc.type ?? '—'} | ${tc.priority ?? '—'} | ${result} |`;
      })].join('\n')
    : '_No test cases designed._';
  const healing = healingAttempts.length
    ? ['| Test | Change | Reason | Outcome |', '|------|--------|--------|---------|',
      ...healingAttempts.map(h => `| ${h.testId} | ${h.change || '—'} | ${h.reason} | ${h.result} |`)].join('\n')
    : '_No healing required._';
  const reuse = ((frameworkDiscovery.reusableForNewStory as string[] | undefined) ?? []).map(r => `- ${r}`).join('\n');

  const report = `# QA Automation Report

**Story:** ${ctx.storyId} — ${ctx.storyFile}
**Date:** ${new Date().toISOString().slice(0, 10)}
**Status:** ${icon} ${status}

## Requirements

${requirements.length} requirement(s) — ${Object.entries(reqCounts).map(([t, n]) => `${n} ${t}`).join(', ')}
${uncovered.length ? `\n⚠️ Not covered by any test case: ${uncovered.map(r => r.id).join(', ')}\n` : ''}
## Test cases

| Total | Automated | Not automatable |
|-------|-----------|-----------------|
| ${testCases.length} | ${automatedTests.length} | ${testCases.filter(tc => tc.automation === false).length} |

## Coverage

${coverage}

## Automation

${[...new Set(automatedTests.map(t => `- \`${t.file}\` (${t.status})`))].join('\n') || '_No spec generated._'}
${reuse ? `\n### Framework reuse\n${reuse}\n` : ''}
## Execution

| Total | Passed | Failed | Skipped | Duration |
|-------|--------|--------|---------|----------|
| ${total} | ${passed} | ${failed} | ${skipped} | ${(dur / 1000).toFixed(1)}s |

## Healing

${healing}

## Product defects

${defects.length ? defects.map(f => `- **[HIGH]** ${f.testId}: ${f.rootCause}`).join('\n') : '_No product defects found._'}

## Final status

${icon} **${status}**
`;
  const reportFile = reportPath(cfg, storyId);
  mkdirSync(dirname(reportFile), { recursive: true });
  writeFileSync(reportFile, report, 'utf-8');
  return { status, reportFile, report };
}
