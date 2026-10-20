#!/usr/bin/env node
/**
 * Stage 9 — Report Generator (deterministic)
 * Templates a QA Automation Report from execution-context.json.
 * Run from apps/qa-ui-orchestrator/:
 *   npx tsx scripts/report-generator.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';

const ORCH_DIR = resolve(process.cwd());
const CTX      = join(ORCH_DIR, 'workflows/execution-context.json');
const OUT_DIR  = join(ORCH_DIR, 'reports');

const ctx = JSON.parse(readFileSync(CTX, 'utf-8'));

const {
  storyId = 'US-???',
  storyFile = '',
  requirements = [],
  testCases = [],
  frameworkDiscovery = {},
  automatedTests = [],
  executionResults = [],
  failures = [],
  healingAttempts = [],
} = ctx;

// ── Counts ────────────────────────────────────────────────────────────────────

const total   = executionResults.length;
const passed  = executionResults.filter((r: any) => r.result === 'PASS').length;
const failed  = executionResults.filter((r: any) => r.result === 'FAIL').length;
const skipped = executionResults.filter((r: any) => r.result === 'SKIP').length;
const dur     = executionResults.reduce((s: number, r: any) => s + (r.duration ?? 0), 0);

const reqCounts: Record<string, number> = {};
for (const r of requirements) reqCounts[r.type] = (reqCounts[r.type] ?? 0) + 1;

const productDefects = failures.filter((f: any) => f.classification === 'PRODUCT_DEFECT');

// ── Final status ──────────────────────────────────────────────────────────────

function finalStatus(): string {
  if (total === 0)           return 'BLOCKED';
  if (productDefects.length) return 'FAIL';
  if (failed > 0)            return 'FAIL';
  const gaps = requirements.length > 0 && testCases.length < requirements.length;
  return gaps ? 'PASS WITH RISKS' : 'PASS';
}
const status     = finalStatus();
const statusIcon = status === 'PASS' ? '✅' : status === 'PASS WITH RISKS' ? '⚠️' : status === 'BLOCKED' ? '🚫' : '❌';

// ── Coverage table ────────────────────────────────────────────────────────────

function coverageTable(): string {
  if (!testCases.length) return '_No test cases designed._';
  const rows = testCases.map((tc: any) => {
    const res    = executionResults.find((r: any) => r.testId === tc.id);
    const result = res ? (res.result === 'PASS' ? '✅ PASS' : res.result === 'FAIL' ? '❌ FAIL' : '⏭ SKIP') : '⏳ Not run';
    return `| ${tc.id} | ${tc.scenario} | ${tc.type ?? '—'} | ${tc.priority ?? '—'} | ${tc.automationStrategy ?? 'UI'} | ${result} |`;
  });
  return [
    '| TC ID | Scenario | Type | Priority | Automation | Result |',
    '|-------|----------|------|----------|------------|--------|',
    ...rows,
  ].join('\n');
}

// ── Healing table ─────────────────────────────────────────────────────────────

function healingTable(): string {
  if (!healingAttempts.length) return '_No healing required._';
  const rows = healingAttempts.map((h: any) =>
    `| ${h.testId} | ${h.change} | ${h.reason} | ${h.result === 'PENDING' ? '⏳ Pending re-run' : h.result === 'PASS' ? '✅ PASS' : '❌ FAIL'} |`,
  );
  return [
    '| Test | Change | Reason | Outcome |',
    '|------|--------|--------|---------|',
    ...rows,
  ].join('\n');
}

// ── Defects section ───────────────────────────────────────────────────────────

function defectsSection(): string {
  if (!productDefects.length) return '_No product defects found._';
  return productDefects
    .map((f: any) => `- **[HIGH]** ${f.testId}: ${f.rootCause}`)
    .join('\n');
}

// ── Reuse summary ─────────────────────────────────────────────────────────────

function reuseSection(): string {
  const created  = automatedTests.filter((t: any) => t.status === 'created').map((t: any) => `- \`${t.file}\``);
  const modified = automatedTests.filter((t: any) => t.status === 'modified').map((t: any) => `- \`${t.file}\``);
  const reused   = automatedTests.filter((t: any) => t.status === 'reused').map((t: any) => `- \`${t.file}\``);
  const reusableItems = (frameworkDiscovery.reusableForNewStory ?? []).map((r: string) => `- ${r}`);
  return [
    created.length       ? `### Created\n${created.join('\n')}`           : '',
    modified.length      ? `### Modified\n${modified.join('\n')}`         : '',
    reused.length        ? `### Reused\n${reused.join('\n')}`             : '',
    reusableItems.length ? `### Framework reuse\n${reusableItems.join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

// ── Report ────────────────────────────────────────────────────────────────────

const today  = new Date().toISOString().slice(0, 10);
const report = `# QA Automation Report

**Story:** ${storyId} — ${storyFile}
**Date:** ${today}
**Status:** ${statusIcon} ${status}

---

## Requirement Analysis

${requirements.length} requirement(s) extracted — ${Object.entries(reqCounts).map(([t, n]) => `${n} ${t}`).join(', ')}

---

## Test Cases

| Total | Automated | Not automatable |
|-------|-----------|-----------------|
| ${testCases.length} | ${automatedTests.length} | ${testCases.filter((tc: any) => tc.automation === false).length} |

---

## Coverage

${coverageTable()}

---

## Automation Changes

${reuseSection() || '_No changes recorded._'}

---

## Execution

| Total | Passed | Failed | Skipped | Duration |
|-------|--------|--------|---------|----------|
| ${total} | ${passed} | ${failed} | ${skipped} | ${(dur / 1000).toFixed(1)}s |

---

## Healing

${healingTable()}

---

## Product Defects

${defectsSection()}

---

## Final Status

${statusIcon} **${status}**
`;

mkdirSync(OUT_DIR, { recursive: true });
const outFile = join(OUT_DIR, `${storyId}-report.md`);
writeFileSync(outFile, report, 'utf-8');

console.log(`\n[report-generator] ${storyId} — ${statusIcon} ${status}`);
console.log(`  Report: ${outFile}`);
console.log(`  ${passed}/${total} passed  |  ${failed} failed  |  ${productDefects.length} defect(s)`);
