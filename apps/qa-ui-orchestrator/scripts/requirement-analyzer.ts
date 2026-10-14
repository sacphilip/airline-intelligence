#!/usr/bin/env node
/**
 * Stage 1 — Requirement Analyzer (deterministic)
 * Parses acceptance criteria from a user story markdown file.
 * Run from apps/qa-ui-orchestrator/:
 *   npx tsx scripts/requirement-analyzer.ts ../../user-stories/US-XXX-story.md
 */
import { readFileSync, writeFileSync } from 'fs';
import { basename, join, resolve } from 'path';

const ORCH_DIR = resolve(process.cwd());
const CTX      = join(ORCH_DIR, 'workflows/execution-context.json');

type RequirementType = 'functional' | 'negative' | 'boundary' | 'ui' | 'state';

function classify(line: string): RequirementType {
  const l = line.toLowerCase();
  if (/invalid|error|missing|reject|fail|not found|empty result|no match|404/.test(l)) return 'negative';
  if (/loading|spinner|indicator|visible|hidden|toggle|expand|collapse|banner|badge|state/.test(l)) return 'ui';
  if (/hash|routing|navigate|redirect|pre.?fill|auto.?search|link|click.*tab|tab.*click/.test(l)) return 'state';
  if (/format|validat|boundary|min|max|length|pattern|at least|at most/.test(l)) return 'boundary';
  return 'functional';
}

const storyPath = process.argv[2];
if (!storyPath) {
  console.error('Usage: npx tsx scripts/requirement-analyzer.ts ../../user-stories/US-XXX-story.md');
  process.exit(1);
}

const absPath = resolve(storyPath);
const content = readFileSync(absPath, 'utf-8');
const lines   = content.split('\n');
const name    = basename(absPath, '.md');
const match   = name.match(/US-\d+/i);
const storyId = match ? match[0].toUpperCase() : name.toUpperCase();

const start = lines.findIndex(l => /^##\s+acceptance criteria/i.test(l));
if (start === -1) {
  console.error(`No "## Acceptance Criteria" section found in ${absPath}`);
  process.exit(1);
}
const end     = lines.findIndex((l, i) => i > start && /^##/.test(l));
const bullets = lines
  .slice(start + 1, end === -1 ? undefined : end)
  .filter(l => /^\s*[-*]/.test(l));

const requirements = bullets.map((line, i) => ({
  id:          `AC-${String(i + 1).padStart(2, '0')}`,
  description: line.replace(/^\s*[-*]\s*/, '').trim(),
  type:        classify(line),
}));

// Guarantee at least one negative requirement
if (!requirements.some(r => r.type === 'negative')) {
  requirements.push({
    id: `NEG-01`,
    description: 'Invalid or missing input returns an appropriate error state',
    type: 'negative',
  });
}

const ctx = JSON.parse(readFileSync(CTX, 'utf-8'));
ctx.storyId            = storyId;
ctx.storyFile          = storyPath;
ctx.status             = 'REQUIREMENTS_DONE';
ctx.requirements       = requirements;
ctx.testCases          = [];
ctx.frameworkDiscovery = {};
ctx.automatedTests     = [];
ctx.executionResults   = [];
ctx.failures           = [];
ctx.healingAttempts    = [];
ctx.defects            = [];

writeFileSync(CTX, JSON.stringify(ctx, null, 2));

console.log(`\n[requirement-analyzer] ${storyId} — ${requirements.length} requirement(s) extracted\n`);
for (const r of requirements) {
  console.log(`  ${r.id}  [${r.type.padEnd(10)}]  ${r.description}`);
}
