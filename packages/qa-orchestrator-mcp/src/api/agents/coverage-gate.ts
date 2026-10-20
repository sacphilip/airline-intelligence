import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { PreTestCoverageAnalysis } from '../schemas/coverage';

// ---------------------------------------------------------------------------
// Phase 4b — Coverage gate
// Runs AFTER coverage gap analysis, BEFORE the test plan review.
// A human sees the coverage gaps and either approves them (proceeds to plan
// review) or flags that the test design needs revision (pipeline stops).
//
// Decision lives in <outputDir>/review/<ID>-coverage.json.
// A decision is only valid for the exact gap set it was made on (hash-matched).
// If the test design changes and gaps change, a new decision is required.
// ---------------------------------------------------------------------------

export type CoverageDecision = 'proceed' | 'revise';

interface CoverageGateFile {
  storyId: string;
  gapsHash: string;
  decision: CoverageDecision;
  reviewer: string;
  notes: string;
  decidedAt: string;
}

function gatePath(reviewDir: string, storyId: string): string {
  return join(reviewDir, `${storyId}-coverage.json`);
}

export function gapsHash(coverage: PreTestCoverageAnalysis): string {
  const data = coverage.gaps.map(g => [g.requirementId, g.gapType]);
  return createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 16);
}

/** 'approved' when a 'proceed' decision matches the current gap set; 'awaiting' otherwise. */
export function checkCoverageGate(
  reviewDir: string,
  storyId: string,
  coverage: PreTestCoverageAnalysis,
): 'approved' | 'awaiting' {
  const path = gatePath(reviewDir, storyId);
  if (!existsSync(path)) return 'awaiting';
  try {
    const file = JSON.parse(readFileSync(path, 'utf-8')) as CoverageGateFile;
    if (file.gapsHash !== gapsHash(coverage)) return 'awaiting';
    return file.decision === 'proceed' ? 'approved' : 'awaiting';
  } catch {
    return 'awaiting';
  }
}

export function recordCoverageDecision(
  reviewDir: string,
  storyId: string,
  coverage: PreTestCoverageAnalysis,
  decision: CoverageDecision,
  reviewer: string,
  notes = '',
): void {
  mkdirSync(reviewDir, { recursive: true });
  const file: CoverageGateFile = {
    storyId,
    gapsHash: gapsHash(coverage),
    decision,
    reviewer,
    notes,
    decidedAt: new Date().toISOString(),
  };
  writeFileSync(gatePath(reviewDir, storyId), JSON.stringify(file, null, 2) + '\n', 'utf-8');
}

/** Human-readable coverage gap summary to present before the gate. */
export function coverageGatePacket(storyId: string, coverage: PreTestCoverageAnalysis): string {
  const lines: string[] = [];
  lines.push(`# Coverage gap analysis — ${storyId}`, '');
  lines.push(`**Requirement coverage: ${coverage.coveragePercent}%** (${coverage.coveredRequirements}/${coverage.totalRequirements})`, '');
  lines.push('| Category | Covered | Total |', '|----------|---------|-------|');
  for (const [cat, c] of Object.entries(coverage.byCategory)) {
    if (c.total > 0) lines.push(`| ${cat} | ${c.covered} | ${c.total} |`);
  }
  lines.push('');
  if (coverage.gaps.length === 0) {
    lines.push('No coverage gaps detected. All requirements are covered by the designed test cases.');
  } else {
    lines.push(`## Gaps (${coverage.gaps.length})`, '');
    for (const g of coverage.gaps) {
      lines.push(`- **${g.gapType}** \`${g.requirementId}\` — ${g.recommendation}`);
    }
  }
  lines.push('');
  lines.push('---');
  lines.push('AWAITING COVERAGE REVIEW. Discuss these gaps with the user, then call `qa_api_coverage_review`:');
  lines.push('- `"proceed"` — accept current coverage and continue to the full test plan review');
  lines.push('- `"revise"` — gaps must be addressed; the pipeline stops and the user adjusts the story or test design before re-running `qa_api_plan`');
  return lines.join('\n') + '\n';
}
