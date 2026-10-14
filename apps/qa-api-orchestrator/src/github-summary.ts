import { appendFileSync } from 'fs';
import { OrchestratorState } from './schemas/state';
import { RequirementType } from './schemas/requirements';

const TYPE_LABEL: Record<RequirementType, string> = {
  functional: 'Functional',
  negative:   'Negative',
  validation: 'Validation',
  schema:     'Schema',
};

const TYPE_EMOJI: Record<RequirementType, string> = {
  functional: '✅',
  negative:   '🚫',
  validation: '🔍',
  schema:     '📐',
};

export function writeGithubSummary(state: OrchestratorState): void {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;

  const md = buildMarkdown(state);
  appendFileSync(summaryPath, md, 'utf-8');
}

function buildMarkdown(state: OrchestratorState): string {
  const run = state.finalRun ?? state.firstRun;
  const reqs = state.requirements;
  const design = state.testDesign;
  const title = reqs?.title ?? state.storyId;
  const healed = state.healAttempted ? (state.firstRun?.failed ?? 0) - (run?.failed ?? 0) : 0;

  const passIcon  = (run?.failed ?? 0) === 0 ? '🟢' : '🔴';
  const lines: string[] = [];

  // ── Stopped at the review gate: no tests were generated ──────────────────
  if (state.stoppedAtReview) {
    const icon = state.stoppedAtReview === 'awaiting' ? '⏸️' : '⛔';
    lines.push(`## ${icon} ${state.storyId} — ${title}`);
    lines.push('');
    lines.push(state.stoppedAtReview === 'awaiting'
      ? '**Awaiting human review of the test plan.** No tests were generated or run.'
      : `**Test plan rejected by ${state.review?.reviewer}:** ${state.review?.comment}. No tests were generated or run.`);
    lines.push('');
    if (state.preCoverage) {
      lines.push(`Planned: ${state.testDesign?.testCases.length ?? 0} test cases, ${state.preCoverage.coveragePercent}% requirement coverage, ${state.preCoverage.gaps.length} gap(s).`);
      lines.push('');
    }
    lines.push('---', '');
    return lines.join('\n');
  }

  // ── Header ───────────────────────────────────────────────────────────────
  lines.push(`## ${passIcon} ${state.storyId} — ${title}`);
  lines.push('');

  // ── Stats table ──────────────────────────────────────────────────────────
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Acceptance criteria | ${reqs?.requirements.length ?? 0} |`);
  lines.push(`| Test cases generated | ${design?.testCases.length ?? 0} |`);
  lines.push(`| ✅ Passed | **${run?.passed ?? 0}** |`);
  lines.push(`| ❌ Failed | **${run?.failed ?? 0}** |`);
  if (state.healAttempted) {
    lines.push(`| 🔧 Auto-healed | ${healed} |`);
  }
  if (run?.duration) {
    lines.push(`| ⏱ Duration | ${(run.duration / 1000).toFixed(1)} s |`);
  }
  if (state.review) {
    const r = state.review;
    const who = r.mode === 'auto' ? 'skipped (auto)' : `approved by ${r.reviewer}`;
    lines.push(`| 👤 Plan review | ${who}${r.excludedTestCaseIds.length ? ` — excluded ${r.excludedTestCaseIds.join(', ')}` : ''}${r.comment && r.mode !== 'auto' ? ` — “${r.comment}”` : ''} |`);
  }
  lines.push('');

  // ── Acceptance criteria ───────────────────────────────────────────────────
  if (reqs && reqs.requirements.length > 0) {
    lines.push('### Acceptance Criteria');
    lines.push('');
    lines.push('| ID | Type | Requirement | Covered |');
    lines.push('|----|------|-------------|---------|');

    for (const req of reqs.requirements) {
      const covered = design?.testCases.some(tc => tc.requirementId === req.id) ?? false;
      const coverage = covered ? '✅ Yes' : '⚠️ No test';
      lines.push(
        `| ${req.id} | ${TYPE_EMOJI[req.type]} ${TYPE_LABEL[req.type]} | ${req.description} | ${coverage} |`,
      );
    }
    lines.push('');
  }

  // ── Test cases by category ────────────────────────────────────────────────
  if (design && design.testCases.length > 0) {
    const byType: Record<string, typeof design.testCases> = {
      functional: [],
      negative:   [],
      validation: [],
      schema:     [],
    };
    for (const tc of design.testCases) {
      const req = reqs?.requirements.find(r => r.id === tc.requirementId);
      const bucket = req?.type ?? 'functional';
      (byType[bucket] ??= []).push(tc);
    }

    const sections: Array<{ type: RequirementType; label: string }> = [
      { type: 'functional', label: 'Positive / Functional' },
      { type: 'negative',   label: 'Negative' },
      { type: 'validation', label: 'Validation & Boundary' },
      { type: 'schema',     label: 'Schema & Structure' },
    ];

    for (const { type, label } of sections) {
      const cases = byType[type];
      if (!cases || cases.length === 0) continue;

      lines.push(`### ${TYPE_EMOJI[type]} ${label} Tests`);
      lines.push('');
      lines.push('| Test | Endpoint | Expected | Result |');
      lines.push('|------|----------|----------|--------|');

      for (const tc of cases) {
        const failure = run?.failures.find(f => f.title === tc.name);
        const result = failure
          ? `❌ \`${failure.error.split('\n')[0].slice(0, 80)}\``
          : '✅ Pass';
        lines.push(
          `| ${tc.name} | \`${tc.method} ${tc.endpoint}\` | HTTP ${tc.expectedStatus} | ${result} |`,
        );
      }
      lines.push('');
    }
  }

  // ── Failure details ───────────────────────────────────────────────────────
  if (run && run.failed > 0) {
    lines.push('### ❌ Failures');
    lines.push('');
    for (const f of run.failures) {
      const diagnosis = state.analysis?.failures.find(a => a.testTitle === f.title);
      lines.push(`<details><summary><b>${f.title}</b></summary>`);
      lines.push('');
      lines.push('```');
      lines.push(f.error.slice(0, 600));
      lines.push('```');
      if (diagnosis) {
        lines.push('');
        lines.push(`**Category:** ${diagnosis.category}  `);
        lines.push(`**Root cause:** ${diagnosis.rootCause}  `);
        lines.push(`**Healable:** ${diagnosis.healable ? 'Yes — auto-fix was applied' : 'No — application bug'}`);
      }
      lines.push('</details>');
      lines.push('');
    }
  }

  // ── Coverage report ───────────────────────────────────────────────────────
  const report = state.coverageReport;
  if (report) {
    const verdictEmoji = report.verdict === 'FULL' ? '✅' : report.verdict === 'PARTIAL' ? '⚠️' : '❌';
    lines.push(`### ${verdictEmoji} Coverage Report — ${report.coverageScore}% (${report.verdict})`);
    lines.push('');

    lines.push('| Category | Covered | Total | % |');
    lines.push('|----------|---------|-------|---|');
    for (const [cat, cov] of Object.entries(report.byCategory)) {
      if (cov.total === 0) continue;
      const bar = '█'.repeat(Math.round(cov.percent / 10)) + '░'.repeat(10 - Math.round(cov.percent / 10));
      lines.push(`| ${TYPE_EMOJI[cat as RequirementType]} ${TYPE_LABEL[cat as RequirementType]} | ${cov.covered} | ${cov.total} | \`${bar}\` ${cov.percent}% |`);
    }
    lines.push('');

    // Scenario list
    lines.push('<details><summary>All scenarios</summary>');
    lines.push('');
    lines.push('| Result | Category | Requirement | Test |');
    lines.push('|--------|----------|-------------|------|');
    for (const s of report.scenarios) {
      const icon = s.passed ? '✅' : '❌';
      const reqCell = `\`${s.requirementId}\` — ${s.requirementDescription}`;
      lines.push(`| ${icon} | ${TYPE_EMOJI[s.category]} ${TYPE_LABEL[s.category]} | ${reqCell} | ${s.testName} |`);
    }
    lines.push('');
    lines.push('</details>');
    lines.push('');

    if (report.untestedRequirements.length > 0) {
      lines.push('#### ⚪ Untested Requirements');
      lines.push('');
      for (const r of report.untestedRequirements) {
        lines.push(`- \`${r.id}\` [${r.type}] ${r.description}`);
      }
      lines.push('');
    }

    if (report.remainingGaps.length > 0) {
      lines.push('#### ⚠️ Coverage Gaps');
      lines.push('');
      for (const g of report.remainingGaps) {
        lines.push(`- **${g.gapType}** — ${g.recommendation}`);
      }
      lines.push('');
    }
  }

  // ── Pre-test gap warnings (if no post-execution report yet) ───────────────
  else if (state.preCoverage && state.preCoverage.gaps.length > 0) {
    lines.push('### ⚠️ Pre-test Coverage Gaps');
    lines.push('');
    for (const g of state.preCoverage.gaps) {
      lines.push(`- **${g.gapType}** — ${g.recommendation}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');

  return lines.join('\n');
}
