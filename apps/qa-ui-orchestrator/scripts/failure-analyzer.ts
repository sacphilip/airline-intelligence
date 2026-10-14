#!/usr/bin/env node
/**
 * Stage 6a — Failure Analyzer (deterministic)
 * Pattern-matches Playwright error messages to failure classifications.
 * Leaves failures it cannot classify as UNKNOWN for LLM investigation.
 * Run from apps/qa-ui-orchestrator/:
 *   npx tsx scripts/failure-analyzer.ts
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

const ORCH_DIR = resolve(process.cwd());
const CTX      = join(ORCH_DIR, 'workflows/execution-context.json');

type Classification =
  | 'ENVIRONMENT_FAILURE'
  | 'TIMING_SYNCHRONIZATION'
  | 'LOCATOR_FAILURE'
  | 'TEST_DATA_FAILURE'
  | 'NETWORK_API_FAILURE'
  | 'PRODUCT_DEFECT'
  | 'TEST_DEFECT'
  | 'UNKNOWN';

type Action = 'HEAL' | 'REPORT_DEFECT' | 'INVESTIGATE';

interface Pattern {
  regex:          RegExp;
  classification: Classification;
  action:         Action;
  rootCause:      (m: RegExpMatchArray) => string;
}

const PATTERNS: Pattern[] = [
  {
    regex: /ECONNREFUSED|ENOTFOUND|connect ETIMEDOUT|net::ERR_CONNECTION/i,
    classification: 'ENVIRONMENT_FAILURE',
    action: 'INVESTIGATE',
    rootCause: () => 'Backend or frontend server is not running or not reachable',
  },
  {
    regex: /timeout.*exceeded|waiting for.*locator|locator.*timed out/i,
    classification: 'TIMING_SYNCHRONIZATION',
    action: 'HEAL',
    rootCause: m => `Element not visible within timeout: ${m[0].substring(0, 120)}`,
  },
  {
    regex: /strict mode violation|resolved to (\d+) element/i,
    classification: 'LOCATOR_FAILURE',
    action: 'HEAL',
    rootCause: m => `Locator matched multiple elements (strict mode): ${m[0].substring(0, 120)}`,
  },
  {
    regex: /element not found|no element matching|locator\.(\w+): element is not/i,
    classification: 'LOCATOR_FAILURE',
    action: 'HEAL',
    rootCause: m => `Element not found in DOM: ${m[0].substring(0, 120)}`,
  },
  {
    regex: /Expected.*toHaveText.*Received|Expected.*toContainText.*Received/i,
    classification: 'TEST_DATA_FAILURE',
    action: 'HEAL',
    rootCause: m => `Text mismatch — mock data may not match component rendering: ${m[0].substring(0, 120)}`,
  },
  {
    regex: /Expected.*toHaveURL.*Received|Expected.*toHaveAttribute.*Received/i,
    classification: 'TEST_DEFECT',
    action: 'HEAL',
    rootCause: m => `Attribute or URL assertion mismatch: ${m[0].substring(0, 120)}`,
  },
  {
    regex: /status code (\d{3})|expected.*status.*(\d{3}).*received.*(\d{3})/i,
    classification: 'PRODUCT_DEFECT',
    action: 'REPORT_DEFECT',
    rootCause: m => `Unexpected HTTP status: ${m[0].substring(0, 120)}`,
  },
  {
    regex: /Cannot read propert|TypeError:|undefined is not/i,
    classification: 'TEST_DEFECT',
    action: 'HEAL',
    rootCause: m => `Null/undefined reference in test — missing null guard: ${m[0].substring(0, 120)}`,
  },
  {
    regex: /route.*not intercepted|page\.route.*missing|unmocked.*api/i,
    classification: 'NETWORK_API_FAILURE',
    action: 'INVESTIGATE',
    rootCause: m => `API call not intercepted by page.route(): ${m[0].substring(0, 120)}`,
  },
];

function classify(error: string): { classification: Classification; action: Action; rootCause: string } {
  for (const p of PATTERNS) {
    const m = error.match(p.regex);
    if (m) {
      return { classification: p.classification, action: p.action, rootCause: p.rootCause(m) };
    }
  }
  return { classification: 'UNKNOWN', action: 'INVESTIGATE', rootCause: 'Could not pattern-match error — needs screenshot/trace inspection' };
}

const ctx    = JSON.parse(readFileSync(CTX, 'utf-8'));
const failed = (ctx.executionResults ?? []).filter((r: any) => r.result === 'FAIL');

if (!failed.length) {
  console.log('[failure-analyzer] No failures to classify.');
  process.exit(0);
}

const failures = failed.map((r: any) => {
  const error = r.error ?? '';
  const { classification, action, rootCause } = classify(error);
  return {
    testId: r.testId,
    classification,
    rootCause,
    evidence: error.split('\n')[0].substring(0, 200),
    action,
  };
});

const counts: Record<string, number> = {};
for (const f of failures) counts[f.classification] = (counts[f.classification] ?? 0) + 1;

const unknown = failures.filter(f => f.classification === 'UNKNOWN');

ctx.failures = failures;
writeFileSync(CTX, JSON.stringify(ctx, null, 2));

console.log(`\n[failure-analyzer] ${failures.length} failure(s) classified\n`);
for (const [cls, n] of Object.entries(counts)) {
  console.log(`  ${cls.padEnd(25)} ${n}`);
}
if (unknown.length) {
  console.log(`\n  ⚠ ${unknown.length} UNKNOWN failure(s) need LLM screenshot/trace investigation:`);
  unknown.forEach(u => console.log(`    - ${u.testId}: ${u.evidence}`));
}
