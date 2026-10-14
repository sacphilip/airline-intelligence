import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, relative } from 'path';
import { RequirementAnalysis } from '../schemas/requirements';
import { TestDesign } from '../schemas/test-case';
import { PreTestCoverageAnalysis } from '../schemas/coverage';
import { ReviewDecision, ReviewDecisionFile, ReviewRecord } from '../schemas/review';

// ---------------------------------------------------------------------------
// Phase 5 — Human review
// Runs AFTER pre-test coverage analysis, BEFORE test generation. A person sees the
// planned test cases and coverage gaps and approves the plan (optionally dropping
// test cases) or rejects it. Nothing is generated or run until the plan is approved.
//
// The decision lives in <outputDir>/review/<ID>-review.json. It is recorded either by
// the MCP client asking the user directly (elicitation) or by the qa_api_review tool
// with the user's answer. There is no terminal prompt: over MCP stdio, stdin carries
// the protocol.
// ---------------------------------------------------------------------------

export interface ReviewInput {
  storyId: string;
  requirements: RequirementAnalysis;
  design: TestDesign;
  coverage: PreTestCoverageAnalysis;
  reviewDir: string;
  projectRoot: string;
  /** Skip the review (recorded as auto-approved so it stays visible). */
  skip?: boolean;
}

export type ReviewOutcome =
  | { status: 'decided'; record: ReviewRecord }
  | { status: 'awaiting'; packetPath: string; decisionPath: string; reason: string; packet: string };

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

export const reviewPaths = (reviewDir: string, storyId: string) => ({
  packetPath: join(reviewDir, `${storyId}-review.md`),
  decisionPath: join(reviewDir, `${storyId}-review.json`),
});

function categoryOf(input: ReviewInput, requirementId: string): string {
  return input.requirements.requirements.find(r => r.id === requirementId)?.type ?? 'functional';
}

export function packetMarkdown(input: ReviewInput, hash: string, decisionPath: string): string {
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
  lines.push(`Record the decision with the \`qa_api_review\` tool, or edit \`${relative(input.projectRoot, decisionPath)}\`:`, '');
  lines.push('- `decision`: `"approve"` or `"reject"`');
  lines.push('- `excludedTestCaseIds`: IDs to drop from the plan (optional, approve only)');
  lines.push('- `reviewer`: your name; `comment`: why (required when rejecting)', '');
  lines.push('Nothing is generated or run until the plan is approved.');
  return lines.join('\n') + '\n';
}

export function validateExclusions(testCaseIds: string[], ids: string[]): string | null {
  const known = new Set(testCaseIds);
  const unknown = ids.filter(id => !known.has(id));
  if (unknown.length) return `Unknown test case ID(s): ${unknown.join(', ')}`;
  if (ids.length >= testCaseIds.length) return 'Excluding every test case leaves nothing to run; reject the plan instead.';
  return null;
}

/** Read the recorded decision for the current plan, or write a fresh pending review packet. */
export function reviewTestPlan(input: ReviewInput): ReviewOutcome {
  const hash = planHash(input.design, input.coverage);
  if (input.skip) {
    return {
      status: 'decided',
      record: {
        mode: 'auto', decision: 'approve', excludedTestCaseIds: [], reviewer: 'auto',
        comment: 'Review skipped', reviewedAt: new Date().toISOString(), planHash: hash,
      },
    };
  }

  mkdirSync(input.reviewDir, { recursive: true });
  const { packetPath, decisionPath } = reviewPaths(input.reviewDir, input.storyId);

  const pending = (reason: string, rewriteDecision = true): ReviewOutcome => {
    if (rewriteDecision) {
      const file: ReviewDecisionFile = {
        storyId: input.storyId, planHash: hash, decision: 'pending', excludedTestCaseIds: [],
        reviewer: '', comment: '', testCaseIds: input.design.testCases.map(tc => tc.id),
      };
      writeFileSync(decisionPath, JSON.stringify(file, null, 2) + '\n', 'utf-8');
    }
    const packet = packetMarkdown(input, hash, decisionPath);
    writeFileSync(packetPath, packet, 'utf-8');
    return { status: 'awaiting', packetPath, decisionPath, reason, packet };
  };

  if (!existsSync(decisionPath)) return pending('No review decision yet.');
  const file = readDecisionFile(decisionPath);
  if (file.planHash !== hash) return pending('The test plan changed since it was last reviewed, so the earlier decision no longer applies.');
  if (file.decision === 'pending') return pending('The review decision is still "pending".', false);

  const record = toRecord(file, decisionPath);
  return { status: 'decided', record: { ...record, planHash: hash } };
}

function readDecisionFile(decisionPath: string): ReviewDecisionFile {
  try {
    return JSON.parse(readFileSync(decisionPath, 'utf-8'));
  } catch (err) {
    throw new Error(`Review file ${decisionPath} is not valid JSON: ${(err as Error).message}`);
  }
}

function toRecord(file: ReviewDecisionFile, decisionPath: string): ReviewRecord {
  if (file.decision !== 'approve' && file.decision !== 'reject') {
    throw new Error(`Review file ${decisionPath}: "decision" must be "approve", "reject" or "pending", not "${file.decision}".`);
  }
  if (!file.reviewer?.trim()) throw new Error(`Review file ${decisionPath}: "reviewer" is required.`);
  if (file.decision === 'reject' && !file.comment?.trim()) throw new Error(`Review file ${decisionPath}: a "comment" explaining the rejection is required.`);
  const excluded = file.decision === 'approve' ? (file.excludedTestCaseIds ?? []) : [];
  const problem = excluded.length ? validateExclusions(file.testCaseIds ?? [], excluded) : null;
  if (problem) throw new Error(`Review file ${decisionPath}: ${problem}`);
  return {
    mode: file.recordedVia ?? 'file', decision: file.decision, excludedTestCaseIds: excluded, reviewer: file.reviewer.trim(),
    comment: file.comment?.trim() ?? '', reviewedAt: new Date().toISOString(), planHash: file.planHash,
  };
}

/**
 * Record a reviewer's decision against the pending review for a story.
 * Fails if there is no pending review, so a decision can't be invented for a plan nobody saw.
 */
export function recordDecision(
  reviewDir: string,
  storyId: string,
  answer: { decision: ReviewDecision; excludedTestCaseIds?: string[]; reviewer: string; comment?: string },
  recordedVia: 'elicit' | 'file' = 'file',
): ReviewRecord {
  const { decisionPath } = reviewPaths(reviewDir, storyId);
  if (!existsSync(decisionPath)) {
    throw new Error(`No pending review for ${storyId}. Run qa_api_plan (or qa_api_run) first so the reviewer sees the plan.`);
  }
  const file = readDecisionFile(decisionPath);
  const updated: ReviewDecisionFile = {
    ...file,
    decision: answer.decision,
    excludedTestCaseIds: answer.decision === 'approve' ? (answer.excludedTestCaseIds ?? []) : [],
    reviewer: answer.reviewer,
    comment: answer.comment ?? '',
    recordedVia,
  };
  const record = toRecord(updated, decisionPath); // validates before writing
  writeFileSync(decisionPath, JSON.stringify(updated, null, 2) + '\n', 'utf-8');
  return record;
}
