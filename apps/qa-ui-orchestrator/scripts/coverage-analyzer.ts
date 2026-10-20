/**
 * coverage-analyzer.ts
 *
 * Runs after Stage 2 (test design). Parses all acceptance criteria from the
 * story file, maps each to the test cases by keyword matching, reports
 * coverage gaps, writes a review packet, and exits with code 3 so the
 * orchestrator pauses for human sign-off before generating specs.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// Scripts run from apps/qa-ui-orchestrator/ (process.cwd())
const ORCH_DIR = process.cwd();
const CTX_FILE = path.join(ORCH_DIR, 'workflows/execution-context.json');
const REVIEW_DIR = path.join(ORCH_DIR, 'reports/review');

interface TestCase {
  id: string;
  scenario: string;
  expected: string;
  steps?: string[];
  requirement?: string;
  type?: string;
  priority?: string;
}

interface AccCriteria {
  id: string;
  section: string;
  text: string;
}

interface Context {
  storyId: string;
  storyFile: string;
  status: string;
  testCases: TestCase[];
  [key: string]: unknown;
}

function parseAcceptanceCriteria(storyPath: string): AccCriteria[] {
  const content = fs.readFileSync(storyPath, 'utf-8');
  const lines = content.split('\n');

  const start = lines.findIndex(l => /^## Acceptance criteria/i.test(l));
  if (start === -1) return [];

  const end = lines.findIndex((l, i) => i > start && /^## [^#]/.test(l));
  const acLines = end === -1 ? lines.slice(start + 1) : lines.slice(start + 1, end);

  const criteria: AccCriteria[] = [];
  let section = 'General';
  let idx = 1;

  for (const line of acLines) {
    const sectionMatch = line.match(/^### (.+)/);
    if (sectionMatch) { section = sectionMatch[1].trim(); continue; }

    const bulletMatch = line.match(/^-\s+(.+)/);
    if (bulletMatch) {
      criteria.push({
        id: `AC-${String(idx++).padStart(2, '0')}`,
        section,
        text: bulletMatch[1].trim(),
      });
    }
  }
  return criteria;
}

function keywords(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3),
  );
}

function isCovered(ac: AccCriteria, testCases: TestCase[]): boolean {
  const acWords = keywords(ac.text);
  for (const tc of testCases) {
    const tcWords = keywords(
      [tc.scenario, tc.expected, ...(tc.steps ?? [])].join(' '),
    );
    const overlap = [...acWords].filter(w => tcWords.has(w)).length;
    // At least 3 overlapping keywords → consider covered
    if (overlap >= 3) return true;
  }
  return false;
}

function tcHash(testCases: TestCase[]): string {
  const payload = testCases.map(tc => `${tc.id}:${tc.scenario}`).join('|');
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

function main() {
  const ctx: Context = JSON.parse(fs.readFileSync(CTX_FILE, 'utf-8'));

  if (ctx.status !== 'TEST_DESIGN_DONE') {
    console.error('[coverage-analyzer] Expected status TEST_DESIGN_DONE, got', ctx.status);
    process.exit(1);
  }

  // storyFile is relative to ORCH_DIR (where scripts are run from)
  const storyPath = path.resolve(ORCH_DIR, ctx.storyFile);
  const criteria = parseAcceptanceCriteria(storyPath);

  if (criteria.length === 0) {
    console.log('[coverage-analyzer] No acceptance criteria found — skipping gate.');
    ctx.status = 'COVERAGE_APPROVED';
    fs.writeFileSync(CTX_FILE, JSON.stringify(ctx, null, 2));
    process.exit(0);
  }

  const covered = criteria.filter(ac => isCovered(ac, ctx.testCases));
  const gaps = criteria.filter(ac => !isCovered(ac, ctx.testCases));
  const pct = Math.round((covered.length / criteria.length) * 100);
  const hash = tcHash(ctx.testCases);

  // Check for existing approved decision
  fs.mkdirSync(REVIEW_DIR, { recursive: true });
  const decisionFile = path.join(REVIEW_DIR, `${ctx.storyId}-ui-coverage.json`);
  if (fs.existsSync(decisionFile)) {
    const decision = JSON.parse(fs.readFileSync(decisionFile, 'utf-8'));
    if (decision.decision === 'approve' && decision.tcHash === hash) {
      console.log(`[coverage-analyzer] ✅ Coverage already approved by ${decision.reviewer}`);
      ctx.status = 'COVERAGE_APPROVED';
      fs.writeFileSync(CTX_FILE, JSON.stringify(ctx, null, 2));
      process.exit(0);
    }
  }

  // Write human-readable review markdown
  const reviewMd = path.join(REVIEW_DIR, `${ctx.storyId}-ui-coverage.md`);
  const coverageTable = criteria.map(ac => {
    const status = isCovered(ac, ctx.testCases) ? '✅' : '❌';
    return `| ${ac.id} | ${ac.section} | ${status} | ${ac.text.slice(0, 80)} |`;
  }).join('\n');

  const gapList = gaps.map(ac =>
    `- **${ac.id}** (${ac.section}): ${ac.text}`
  ).join('\n');

  const tcList = ctx.testCases.map(tc =>
    `| ${tc.id} | ${tc.priority ?? '?'} | ${tc.scenario} |`
  ).join('\n');

  const md = `# Coverage gap review — ${ctx.storyId} (UI)

Story: ${ctx.storyId}
Test-case hash: \`${hash}\`

**Requirement coverage: ${pct}%** (${covered.length}/${criteria.length})

## Acceptance criteria status

| ID | Section | ✅ | Text |
|----|---------|---|------|
${coverageTable}

## Coverage gaps (${gaps.length})

${gaps.length === 0 ? '_No gaps — all criteria have matching test cases._' : gapList}

## Planned test cases (${ctx.testCases.length})

| ID | Priority | Scenario |
|----|----------|----------|
${tcList}

## How to decide

Edit \`reports/review/${ctx.storyId}-ui-coverage.json\`:

- \`decision\`: \`"approve"\` or \`"reject"\`
- \`excludedTestCaseIds\`: IDs to drop (approve only, optional)
- \`reviewer\`: your name; \`comment\`: reason (required when rejecting)

Then run the orchestrator again with the same story. Nothing is generated or run until the plan is approved.
`;

  fs.writeFileSync(reviewMd, md);

  // Write pending decision file
  const decisionObj = {
    storyId: ctx.storyId,
    tcHash: hash,
    decision: 'pending',
    excludedTestCaseIds: [] as string[],
    reviewer: '',
    comment: '',
    testCaseIds: ctx.testCases.map(tc => tc.id),
  };
  fs.writeFileSync(decisionFile, JSON.stringify(decisionObj, null, 2));

  // Update execution context
  ctx.status = 'COVERAGE_REVIEW_PENDING';
  (ctx as Record<string, unknown>)['coverageGap'] = {
    total: criteria.length,
    covered: covered.length,
    gaps: gaps.map(ac => ({ id: ac.id, section: ac.section, text: ac.text })),
    tcHash: hash,
  };
  fs.writeFileSync(CTX_FILE, JSON.stringify(ctx, null, 2));

  // Print the review packet for the LLM/human
  console.log('[coverage-analyzer] Coverage review required');
  console.log('');
  console.log(md);
  console.log('');
  console.log(`  Review file: ${reviewMd}`);
  console.log(`  Decision file: ${decisionFile}`);

  process.exit(3);
}

main();
