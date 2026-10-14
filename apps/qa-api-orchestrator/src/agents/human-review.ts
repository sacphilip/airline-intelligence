import { createHash } from 'crypto';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { userInfo } from 'os';
import { join, relative } from 'path';
import { createInterface } from 'readline/promises';
import { RequirementAnalysis } from '../schemas/requirements';
import { TestDesign } from '../schemas/test-case';
import { PreTestCoverageAnalysis } from '../schemas/coverage';
import { ReviewDecisionFile, ReviewMode, ReviewRecord } from '../schemas/review';

// ---------------------------------------------------------------------------
// Phase 5 — Human review
// Runs AFTER pre-test coverage analysis, BEFORE test generation. A person sees
// the planned test cases and the coverage gaps, then approves the plan (optionally
// dropping test cases) or rejects it. Nothing is generated or run until approved.
// ---------------------------------------------------------------------------

export interface ReviewInput {
  mode: ReviewMode;
  storyId: string;
  requirements: RequirementAnalysis;
  design: TestDesign;
  coverage: PreTestCoverageAnalysis;
  /** Recomputes coverage for a reduced plan, so the reviewer sees the effect of exclusions. */
  analyze: (design: TestDesign) => PreTestCoverageAnalysis;
  reviewDir: string;
}

export type ReviewOutcome =
  | { status: 'decided'; record: ReviewRecord }
  | { status: 'awaiting'; packetPath: string; decisionPath: string; reason: string };

export function resolveReviewMode(flag: string | undefined): ReviewMode {
  const value = (flag ?? process.env.QA_REVIEW ?? '').trim().toLowerCase();
  if (value === 'interactive' || value === 'file' || value === 'auto') return value;
  if (value) throw new Error(`Unknown review mode "${value}". Use interactive, file or auto.`);
  // No TTY means nobody can answer a prompt (an agent or CI is running us): wait for a decision file.
  return process.stdin.isTTY ? 'interactive' : 'file';
}

/** Identifies the exact plan under review; any change to test cases or gaps changes it. */
export function planHash(design: TestDesign, coverage: PreTestCoverageAnalysis): string {
  const plan = {
    testCases: design.testCases.map(tc => [tc.id, tc.name, tc.method, tc.endpoint, tc.expectedStatus, tc.requirementId]),
    gaps: coverage.gaps.map(g => [g.requirementId, g.gapType]),
  };
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex').slice(0, 16);
}

export function applyExclusions(design: TestDesign, excluded: string[]): TestDesign {
  const drop = new Set(excluded);
  return { ...design, testCases: design.testCases.filter(tc => !drop.has(tc.id)) };
}

export async function reviewTestPlan(input: ReviewInput): Promise<ReviewOutcome> {
  const hash = planHash(input.design, input.coverage);
  if (input.mode === 'auto') {
    return {
      status: 'decided',
      record: {
        mode: 'auto', decision: 'approve', excludedTestCaseIds: [], reviewer: 'auto',
        comment: 'Review skipped (--review=auto)', reviewedAt: new Date().toISOString(), planHash: hash,
      },
    };
  }
  return input.mode === 'interactive' ? reviewInteractively(input, hash) : reviewByFile(input, hash);
}

// ── Shared presentation ────────────────────────────────────────────────────

function categoryOf(input: ReviewInput, requirementId: string): string {
  return input.requirements.requirements.find(r => r.id === requirementId)?.type ?? 'functional';
}

function packetMarkdown(input: ReviewInput, hash: string, decisionPath: string): string {
  const { storyId, coverage, design } = input;
  const lines: string[] = [];
  lines.push(`# Test plan review — ${storyId}`, '');
  lines.push(`Story: ${input.requirements.title ?? storyId}  `);
  lines.push(`Plan hash: \`${hash}\``, '');
  lines.push(`**Requirement coverage: ${coverage.coveragePercent}%** (${coverage.coveredRequirements}/${coverage.totalRequirements})`, '');
  lines.push('| Category | Covered | Total |', '|----------|---------|-------|');
  for (const [cat, c] of Object.entries(coverage.byCategory)) {
    if (c.total > 0) lines.push(`| ${cat} | ${c.covered} | ${c.total} |`);
  }
  lines.push('');
  lines.push(`## Coverage gaps (${coverage.gaps.length})`, '');
  if (coverage.gaps.length === 0) lines.push('None.');
  for (const g of coverage.gaps) lines.push(`- **${g.gapType}** \`${g.requirementId}\` — ${g.recommendation}`);
  lines.push('');
  lines.push(`## Planned test cases (${design.testCases.length})`, '');
  lines.push('| ID | Category | Request | Expect | Test |', '|----|----------|---------|--------|------|');
  for (const tc of design.testCases) {
    lines.push(`| ${tc.id} | ${categoryOf(input, tc.requirementId)} | \`${tc.method} ${tc.endpoint}\` | ${tc.expectedStatus} | ${tc.name} |`);
  }
  lines.push('');
  lines.push('## How to decide', '');
  lines.push(`Edit \`${relative(process.cwd(), decisionPath)}\`:`, '');
  lines.push('- `decision`: `"approve"` or `"reject"`');
  lines.push('- `excludedTestCaseIds`: IDs to drop from the plan (optional, approve only)');
  lines.push('- `reviewer`: your name; `comment`: why (required when rejecting)', '');
  lines.push('Then run the orchestrator again with the same story. Nothing is generated or run until the plan is approved.');
  return lines.join('\n') + '\n';
}

function printPlan(input: ReviewInput, detailed: boolean): void {
  const { coverage, design } = input;
  console.log('\n' + '─'.repeat(60));
  console.log(`  Human review — ${input.storyId}: ${coverage.coveragePercent}% requirement coverage, ${coverage.gaps.length} gap(s)`);
  console.log('─'.repeat(60));
  for (const g of coverage.gaps) console.log(`  ⚠ [${g.gapType}] ${g.recommendation}`);
  console.log(`\n  Planned test cases (${design.testCases.length}):`);
  for (const tc of design.testCases) {
    console.log(`    ${tc.id.padEnd(8)} [${categoryOf(input, tc.requirementId)}] ${tc.method} ${tc.endpoint} → ${tc.expectedStatus}  ${tc.name}`);
    if (detailed) {
      console.log(`             ${tc.description}`);
      if (tc.queryParams) console.log(`             query: ${JSON.stringify(tc.queryParams)}`);
      if (tc.expectedFields?.length) console.log(`             fields: ${tc.expectedFields.join(', ')}`);
    }
  }
  console.log('─'.repeat(60));
}

function defaultReviewer(): string {
  if (process.env.QA_REVIEWER) return process.env.QA_REVIEWER;
  try {
    const name = execSync('git config user.name', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (name) return name;
  } catch { /* not a git checkout */ }
  return userInfo().username;
}

function validateExclusions(design: TestDesign, ids: string[]): string | null {
  const known = new Set(design.testCases.map(tc => tc.id));
  const unknown = ids.filter(id => !known.has(id));
  if (unknown.length) return `Unknown test case ID(s): ${unknown.join(', ')}`;
  if (ids.length >= design.testCases.length) return 'Excluding every test case leaves nothing to run; reject the plan instead.';
  return null;
}

// ── Interactive (terminal) ─────────────────────────────────────────────────

async function reviewInteractively(input: ReviewInput, hash: string): Promise<ReviewOutcome> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
  // Read through the line iterator, which buffers input typed (or piped) ahead of a prompt.
  // If input ends before a decision (Ctrl+D, Ctrl+C, closed pipe), abort: a review never passes by default.
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (prompt: string): Promise<string> => {
    process.stdout.write(prompt);
    const next = await lines.next();
    if (next.done) throw new Error('Human review aborted: input closed before a decision was made. No tests were generated.');
    if (!process.stdin.isTTY) process.stdout.write(`${next.value}\n`); // echo piped answers so the log reads naturally
    return next.value;
  };
  rl.on('SIGINT', () => rl.close());
  try {
    printPlan(input, false);
    let excluded: string[] = [];

    for (;;) {
      const answer = (await ask('\n  Decision — [a]pprove, [e]xclude test cases, [r]eject, [d]etails: ')).trim().toLowerCase();

      if (answer === 'd') { printPlan(input, true); continue; }

      if (answer === 'e') {
        const ids = (await ask('  Test case IDs to exclude (comma-separated): '))
          .split(',').map(s => s.trim()).filter(Boolean);
        const problem = validateExclusions(input.design, ids);
        if (problem) { console.log(`  ✗ ${problem}`); continue; }
        const reduced = input.analyze(applyExclusions(input.design, ids));
        console.log(`  Without ${ids.join(', ')}: ${reduced.coveragePercent}% coverage, ${reduced.gaps.length} gap(s).`);
        const confirm = (await ask('  Approve the reduced plan? [y/n]: ')).trim().toLowerCase();
        if (confirm !== 'y') continue;
        excluded = ids;
      } else if (answer !== 'a' && answer !== 'r') {
        console.log('  Please answer a, e, r or d.');
        continue;
      }

      const decision = answer === 'r' ? 'reject' : 'approve';
      let comment = '';
      while (decision === 'reject' && !comment) comment = (await ask('  Reason for rejecting (required): ')).trim();
      if (decision === 'approve') comment = (await ask('  Comment (optional): ')).trim();
      const reviewer = (await ask(`  Reviewer [${defaultReviewer()}]: `)).trim() || defaultReviewer();

      return {
        status: 'decided',
        record: { mode: 'interactive', decision, excludedTestCaseIds: excluded, reviewer, comment, reviewedAt: new Date().toISOString(), planHash: hash },
      };
    }
  } finally {
    rl.close();
  }
}

// ── File (no terminal: agents, CI) ─────────────────────────────────────────

async function reviewByFile(input: ReviewInput, hash: string): Promise<ReviewOutcome> {
  mkdirSync(input.reviewDir, { recursive: true });
  const packetPath = join(input.reviewDir, `${input.storyId}-review.md`);
  const decisionPath = join(input.reviewDir, `${input.storyId}-review.json`);

  const pending = (reason: string): ReviewOutcome => {
    const file: ReviewDecisionFile = {
      storyId: input.storyId, planHash: hash, decision: 'pending', excludedTestCaseIds: [],
      reviewer: '', comment: '', testCaseIds: input.design.testCases.map(tc => tc.id),
    };
    writeFileSync(decisionPath, JSON.stringify(file, null, 2) + '\n', 'utf-8');
    writeFileSync(packetPath, packetMarkdown(input, hash, decisionPath), 'utf-8');
    return { status: 'awaiting', packetPath, decisionPath, reason };
  };

  if (!existsSync(decisionPath)) return pending('No review decision yet.');

  let file: ReviewDecisionFile;
  try {
    file = JSON.parse(readFileSync(decisionPath, 'utf-8'));
  } catch (err) {
    throw new Error(`Review file ${decisionPath} is not valid JSON: ${(err as Error).message}`);
  }

  if (file.planHash !== hash) return pending('The test plan changed since it was last reviewed, so the earlier decision no longer applies.');
  if (file.decision === 'pending') {
    writeFileSync(packetPath, packetMarkdown(input, hash, decisionPath), 'utf-8');
    return { status: 'awaiting', packetPath, decisionPath, reason: 'The review decision is still "pending".' };
  }
  if (file.decision !== 'approve' && file.decision !== 'reject') {
    throw new Error(`Review file ${decisionPath}: "decision" must be "approve", "reject" or "pending", not "${file.decision}".`);
  }
  if (!file.reviewer?.trim()) throw new Error(`Review file ${decisionPath}: "reviewer" is required.`);
  if (file.decision === 'reject' && !file.comment?.trim()) throw new Error(`Review file ${decisionPath}: a "comment" explaining the rejection is required.`);

  const excluded = file.decision === 'approve' ? (file.excludedTestCaseIds ?? []) : [];
  const problem = excluded.length ? validateExclusions(input.design, excluded) : null;
  if (problem) throw new Error(`Review file ${decisionPath}: ${problem}`);

  return {
    status: 'decided',
    record: {
      mode: 'file', decision: file.decision, excludedTestCaseIds: excluded, reviewer: file.reviewer.trim(),
      comment: file.comment?.trim() ?? '', reviewedAt: new Date().toISOString(), planHash: hash,
    },
  };
}
