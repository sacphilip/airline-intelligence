#!/usr/bin/env node
/**
 * Stage 7a — Test Healer (deterministic)
 * Applies automatic fixes for TIMING_SYNCHRONIZATION failures.
 * TEST_DATA_FAILURE and LOCATOR_FAILURE require LLM reasoning — flagged here, not touched.
 * Run from apps/qa-ui-orchestrator/:
 *   npx tsx scripts/test-healer.ts
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';

const ORCH_DIR     = resolve(process.cwd());
const PROJECT_ROOT = resolve(ORCH_DIR, '../..');
const CTX          = join(ORCH_DIR, 'workflows/execution-context.json');

// ── Healing rules for TIMING_SYNCHRONIZATION ─────────────────────────────────

function healTiming(src: string): { healed: string; changes: string[] } {
  const changes: string[] = [];
  let healed = src;

  // toBeVisible() → toBeVisible({ timeout: 10_000 })
  if (/\.toBeVisible\(\s*\)/.test(healed)) {
    healed = healed.replace(/\.toBeVisible\(\s*\)/g, '.toBeVisible({ timeout: 10_000 })');
    changes.push('toBeVisible() → toBeVisible({ timeout: 10_000 })');
  }

  // toBeHidden() → toBeHidden({ timeout: 10_000 })
  if (/\.toBeHidden\(\s*\)/.test(healed)) {
    healed = healed.replace(/\.toBeHidden\(\s*\)/g, '.toBeHidden({ timeout: 10_000 })');
    changes.push('toBeHidden() → toBeHidden({ timeout: 10_000 })');
  }

  // Remove arbitrary waitForTimeout()
  if (/await page\.waitForTimeout\(\d+\)/.test(healed)) {
    healed = healed.replace(/await page\.waitForTimeout\(\d+\);?\n?/g, '');
    changes.push('Removed arbitrary waitForTimeout()');
  }

  return { healed, changes };
}

// ── Main ─────────────────────────────────────────────────────────────────────

const ctx      = JSON.parse(readFileSync(CTX, 'utf-8'));
const healable = (ctx.failures ?? []).filter((f: any) =>
  f.action === 'HEAL' && f.classification === 'TIMING_SYNCHRONIZATION',
);
const needsLlm = (ctx.failures ?? []).filter((f: any) =>
  f.action === 'HEAL' && f.classification !== 'TIMING_SYNCHRONIZATION',
);

if (!healable.length) {
  console.log('[test-healer] No TIMING_SYNCHRONIZATION failures to heal automatically.');
  if (needsLlm.length) {
    console.log(`\n  ⚠ ${needsLlm.length} failure(s) need LLM healing (not touched):`);
    needsLlm.forEach((f: any) => console.log(`    - ${f.testId} [${f.classification}]: ${f.rootCause}`));
  }
  process.exit(0);
}

// Group failures by spec file
const byFile: Record<string, string[]> = {};
for (const f of healable) {
  const at   = ctx.automatedTests?.find((at: any) => at.testCaseId === f.testId);
  const file = at?.file ? join(PROJECT_ROOT, at.file) : null;
  if (!file) continue;
  (byFile[file] ??= []).push(f.testId);
}

const attempts: any[] = ctx.healingAttempts ?? [];

for (const [file, testIds] of Object.entries(byFile)) {
  if (!existsSync(file)) { console.warn(`  ⚠ Spec file not found: ${file}`); continue; }

  const original = readFileSync(file, 'utf-8');
  const { healed, changes } = healTiming(original);

  if (changes.length === 0) {
    console.log(`  ~ No timing patterns found in ${file} — may need LLM`);
    continue;
  }

  writeFileSync(file, healed, 'utf-8');

  for (const testId of testIds) {
    attempts.push({
      testId,
      attempt: 1,
      change: changes.join('; '),
      reason: 'TIMING_SYNCHRONIZATION — added explicit timeouts to assertions',
      result: 'PENDING',
    });
    console.log(`  ✓ Healed ${testId}: ${changes.join('; ')}`);
  }
}

ctx.healingAttempts = attempts;
writeFileSync(CTX, JSON.stringify(ctx, null, 2));

console.log(`\n[test-healer] Deterministic healing done.`);
if (needsLlm.length) {
  console.log(`\n  ⚠ ${needsLlm.length} failure(s) still need LLM healing:`);
  needsLlm.forEach((f: any) => console.log(`    - ${f.testId} [${f.classification}]: ${f.rootCause}`));
  console.log(`  → Hand these to the Healing Agent (LLM step) in agents/healing-agent.md`);
}
