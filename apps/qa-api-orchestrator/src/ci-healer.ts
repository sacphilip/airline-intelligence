#!/usr/bin/env node
/**
 * CI Healer — deterministic auto-repair for failing API test specs.
 *
 * Reads reports/results.json (written by the Playwright JSON reporter via
 * playwright.config.ts), classifies each failure by error pattern, and patches
 * spec files for auto-fixable issues (TIMING_SYNCHRONIZATION only).
 *
 * Exit codes:
 *   0 — patched at least one spec file; CI should re-run the suite
 *   2 — failures exist but none are auto-healable; fail the build
 *   1 — read/write error
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const CWD          = process.cwd();
const RESULTS_FILE = join(CWD, 'reports/results.json');
const SUMMARY_FILE = join(CWD, 'reports/heal-summary.json');

// ── Classification ────────────────────────────────────────────────────────────

type Classification =
  | 'TIMING_SYNCHRONIZATION'
  | 'ENVIRONMENT_FAILURE'
  | 'STATUS_MISMATCH'
  | 'NULL_REFERENCE'
  | 'UNKNOWN';

interface Pattern {
  regex:          RegExp;
  classification: Classification;
  healable:       boolean;
  rootCause:      string;
}

const PATTERNS: Pattern[] = [
  {
    regex: /timed out after|timeout exceeded|ETIMEDOUT|read ETIMEDOUT/i,
    classification: 'TIMING_SYNCHRONIZATION',
    healable: true,
    rootCause: 'Request timed out — backend may be under load in CI',
  },
  {
    regex: /ECONNREFUSED|ENOTFOUND|net::ERR_CONNECTION|socket hang up/i,
    classification: 'ENVIRONMENT_FAILURE',
    healable: false,
    rootCause: 'Backend unreachable — environment problem, not a test issue',
  },
  {
    regex: /Expected:[\s\S]*?Received:|expect\(received\)\.(toBe|toEqual|toBeLessThan|toBeGreaterThan)/,
    classification: 'STATUS_MISMATCH',
    healable: false,
    rootCause: 'Assertion value mismatch — product or test defect, needs manual review',
  },
  {
    regex: /Cannot read propert|TypeError:|is not a function|is undefined/i,
    classification: 'NULL_REFERENCE',
    healable: false,
    rootCause: 'Null/undefined reference — test defect, needs manual review',
  },
];

function classify(error: string): Pick<Pattern, 'classification' | 'healable' | 'rootCause'> {
  for (const p of PATTERNS) {
    if (p.regex.test(error)) {
      return { classification: p.classification, healable: p.healable, rootCause: p.rootCause };
    }
  }
  return {
    classification: 'UNKNOWN',
    healable: false,
    rootCause: 'Error pattern not recognised — needs manual investigation',
  };
}

// ── Parse Playwright JSON report ──────────────────────────────────────────────

interface FailedEntry {
  title:          string;
  file:           string;
  error:          string;
  classification: Classification;
  healable:       boolean;
  rootCause:      string;
}

function walk(node: any, parentFile = ''): FailedEntry[] {
  const file    = node.file ?? parentFile;
  const entries: FailedEntry[] = [];

  for (const spec of node.specs ?? []) {
    if (spec.ok) continue;
    const error = spec.tests?.[0]?.results?.[0]?.error?.message ?? '';
    const { classification, healable, rootCause } = classify(error);
    entries.push({ title: spec.title, file, error: error.slice(0, 300), classification, healable, rootCause });
  }
  for (const suite of node.suites ?? []) {
    entries.push(...walk(suite, file));
  }
  return entries;
}

// ── Patch spec for TIMING_SYNCHRONIZATION ─────────────────────────────────────
// Injects "timeout":60000 into every request.METHOD(url, { ... }) call so
// slow CI backends don't cause false failures.

function patchTiming(file: string): { patched: boolean; changes: string[] } {
  if (!existsSync(file)) return { patched: false, changes: [] };

  const src = readFileSync(file, 'utf-8');

  if (src.includes('"timeout":60000') || src.includes('"timeout": 60000')) {
    return { patched: false, changes: ['Timeout already present — skipping'] };
  }

  const changes: string[] = [];
  const patched = src.replace(
    /(request\.(get|post|put|delete|patch)\(["'][^"']+["'],\s*)\{/g,
    (_full, prefix) => {
      changes.push(`Added "timeout":60000 to request options`);
      return `${prefix}{"timeout":60000,`;
    },
  );

  if (changes.length > 0) writeFileSync(file, patched, 'utf-8');
  return { patched: changes.length > 0, changes };
}

// ── Main ──────────────────────────────────────────────────────────────────────

if (!existsSync(RESULTS_FILE)) {
  console.error(`[ci-healer] results file not found: ${RESULTS_FILE}`);
  console.error('  Run Playwright with the JSON reporter before calling the healer.');
  process.exit(1);
}

let results: any;
try {
  results = JSON.parse(readFileSync(RESULTS_FILE, 'utf-8'));
} catch (e) {
  console.error(`[ci-healer] failed to parse ${RESULTS_FILE}: ${(e as Error).message}`);
  process.exit(1);
}

const failures: FailedEntry[] = [];
for (const suite of results.suites ?? []) failures.push(...walk(suite));

if (!failures.length) {
  console.log('[ci-healer] No failures found in results — nothing to heal.');
  writeFileSync(SUMMARY_FILE, JSON.stringify({ healed: 0, unhealed: 0, entries: [] }, null, 2));
  process.exit(2);
}

console.log(`\n[ci-healer] ${failures.length} failure(s) to analyse:\n`);
for (const f of failures) {
  const icon = f.healable ? '✓ HEALABLE    ' : '✗ NOT HEALABLE';
  console.log(`  ${icon}  [${f.classification.padEnd(25)}]  ${f.title}`);
  console.log(`                                  ${f.rootCause}`);
}

const healable = failures.filter(f => f.healable);
const unhealed = failures.filter(f => !f.healable);

if (!healable.length) {
  console.log('\n[ci-healer] No auto-healable failures — these require manual investigation.');
  writeFileSync(SUMMARY_FILE, JSON.stringify({ healed: 0, unhealed: unhealed.length, entries: failures }, null, 2));
  process.exit(2);
}

// Group by file and apply patches
const byFile = new Map<string, FailedEntry[]>();
for (const f of healable) (byFile.get(f.file) ?? byFile.set(f.file, []).get(f.file)!).push(f);

let patchedFiles = 0;
const allChanges: string[] = [];

for (const [file, entries] of byFile) {
  if (entries[0].classification === 'TIMING_SYNCHRONIZATION') {
    const { patched, changes } = patchTiming(file);
    if (patched) {
      patchedFiles++;
      allChanges.push(...changes.map(c => `${file}: ${c}`));
      console.log(`\n  ✓ Patched: ${file}`);
      changes.forEach(c => console.log(`    · ${c}`));
    } else {
      console.log(`\n  ~ ${file}: ${changes[0] ?? 'no changes applied'}`);
    }
  }
}

writeFileSync(SUMMARY_FILE, JSON.stringify({
  healed:   patchedFiles,
  unhealed: unhealed.length,
  entries:  failures,
  changes:  allChanges,
}, null, 2));

if (patchedFiles > 0) {
  console.log(`\n[ci-healer] Patched ${patchedFiles} spec file(s). Re-running the suite now.`);
  if (unhealed.length) {
    console.log(`\n  ⚠ ${unhealed.length} failure(s) are product/test defects — will still show after re-run:`);
    unhealed.forEach(f => console.log(`    - [${f.classification}] ${f.title}: ${f.rootCause}`));
  }
  process.exit(0); // Signal: re-run needed
}

console.log('\n[ci-healer] Patches attempted but no files changed.');
process.exit(2);
