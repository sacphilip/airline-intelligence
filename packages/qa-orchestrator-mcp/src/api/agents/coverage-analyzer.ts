import { RequirementAnalysis, RequirementType } from '../schemas/requirements';
import { TestDesign } from '../schemas/test-case';
import { ExecutionResult } from '../schemas/failure';
import {
  CoverageGap,
  CategoryCoverage,
  PreTestCoverageAnalysis,
  CoveredScenario,
  PostExecutionCoverageReport,
} from '../schemas/coverage';
import { titleMatches } from '../playwright/executor';

const ALL_TYPES: RequirementType[] = ['functional', 'negative', 'validation', 'schema'];

function emptyCategory(): CategoryCoverage {
  return { total: 0, covered: 0, percent: 0 };
}

function pct(covered: number, total: number): number {
  return total === 0 ? 100 : Math.round((covered / total) * 100);
}

// ---------------------------------------------------------------------------
// Phase 4 — Pre-test gap analysis
// Runs AFTER test design, BEFORE test generation.
// Finds requirements that have no test, functional reqs with no negative
// counterpart, and endpoints with no schema assertion.
// ---------------------------------------------------------------------------
export function analyzePreTestCoverage(
  requirements: RequirementAnalysis,
  design: TestDesign,
): PreTestCoverageAnalysis {
  const gaps: CoverageGap[] = [];
  const byCategory: Record<RequirementType, CategoryCoverage> = {
    functional: emptyCategory(),
    negative: emptyCategory(),
    validation: emptyCategory(),
    schema: emptyCategory(),
  };

  for (const req of requirements.requirements) {
    const cat = byCategory[req.type];
    cat.total++;

    const mappedTests = design.testCases.filter(tc => tc.requirementId === req.id);

    if (mappedTests.length === 0) {
      gaps.push({
        requirementId: req.id,
        requirementDescription: req.description,
        requirementType: req.type,
        gapType: 'no_test_mapped',
        recommendation: `No test case covers requirement ${req.id}. Add a test that directly validates: "${req.description}"`,
      });
      continue;
    }

    cat.covered++;

    // Functional reqs should have at least one negative counterpart somewhere
    if (req.type === 'functional') {
      const hasNegativePeer = requirements.requirements.some(
        r => r.type === 'negative' && design.testCases.some(tc => tc.requirementId === r.id),
      );
      if (!hasNegativePeer) {
        gaps.push({
          requirementId: req.id,
          requirementDescription: req.description,
          requirementType: req.type,
          gapType: 'no_negative_counterpart',
          recommendation: `Functional requirement "${req.description}" has no corresponding negative test. Add a test for invalid input, missing params, or error responses.`,
        });
      }
    }

    // Validation reqs should assert boundary values
    if (req.type === 'validation') {
      const hasBoundary = mappedTests.some(
        tc => tc.name.toLowerCase().includes('bound') ||
              tc.name.toLowerCase().includes('min') ||
              tc.name.toLowerCase().includes('max') ||
              tc.name.toLowerCase().includes('range') ||
              tc.name.toLowerCase().includes('invalid'),
      );
      if (!hasBoundary) {
        gaps.push({
          requirementId: req.id,
          requirementDescription: req.description,
          requirementType: req.type,
          gapType: 'no_validation_boundary',
          recommendation: `Validation requirement "${req.description}" should include boundary value tests (min, max, out-of-range, invalid format).`,
        });
      }
    }
  }

  // Check each endpoint has at least one schema test
  const endpoints = [...new Set(design.testCases.map(tc => `${tc.method} ${tc.endpoint}`))];
  for (const ep of endpoints) {
    const hasSchema = design.testCases.some(
      tc => `${tc.method} ${tc.endpoint}` === ep &&
            requirements.requirements.find(r => r.id === tc.requirementId)?.type === 'schema',
    );
    if (!hasSchema) {
      gaps.push({
        requirementId: `schema-${ep.replace(/[^a-z0-9]/gi, '_')}`,
        requirementDescription: `Schema validation for ${ep}`,
        requirementType: 'schema',
        gapType: 'no_schema_assertion',
        recommendation: `Endpoint ${ep} has no schema test. Add a test that asserts all required response fields are present with correct types.`,
      });
    }
  }

  for (const type of ALL_TYPES) {
    byCategory[type].percent = pct(byCategory[type].covered, byCategory[type].total);
  }

  const totalReqs = requirements.requirements.length;
  const covered = ALL_TYPES.reduce((n, t) => n + byCategory[t].covered, 0);

  return {
    totalRequirements: totalReqs,
    coveredRequirements: covered,
    coveragePercent: pct(covered, totalReqs),
    byCategory,
    gaps,
  };
}

// ---------------------------------------------------------------------------
// Phase 10 — Post-execution coverage report
// Runs AFTER the final test execution.
// Maps each test result back to its requirement and surfaces what passed,
// what failed, and what was never reached.
// ---------------------------------------------------------------------------
export function buildPostExecutionReport(
  requirements: RequirementAnalysis,
  design: TestDesign,
  execution: ExecutionResult,
  preGaps: CoverageGap[],
): PostExecutionCoverageReport {
  const scenarios: CoveredScenario[] = design.testCases.map(tc => {
    const req = requirements.requirements.find(r => r.id === tc.requirementId);
    // Generated titles are "<id>: <name>", so match on the id as well as the name.
    const failure = execution.failures.find(f => titleMatches(f.title, tc));
    const failed = !!failure;
    const failureDetail = failure?.error.split('\n')[0];

    return {
      testCaseId: tc.id,
      testName: tc.name,
      category: req?.type ?? 'functional',
      requirementId: tc.requirementId,
      requirementDescription: req?.description ?? tc.description,
      passed: !failed,
      failureReason: failureDetail,
    };
  });

  const testedReqIds = new Set(design.testCases.map(tc => tc.requirementId));
  const untestedRequirements = requirements.requirements.filter(r => !testedReqIds.has(r.id));

  const byCategory: Record<RequirementType, CategoryCoverage> = {
    functional: emptyCategory(),
    negative: emptyCategory(),
    validation: emptyCategory(),
    schema: emptyCategory(),
  };

  for (const req of requirements.requirements) {
    const cat = byCategory[req.type];
    cat.total++;
    const reqScenarios = scenarios.filter(s => s.requirementId === req.id);
    if (reqScenarios.length > 0 && reqScenarios.every(s => s.passed)) {
      cat.covered++;
    }
  }

  for (const type of ALL_TYPES) {
    byCategory[type].percent = pct(byCategory[type].covered, byCategory[type].total);
  }

  // Remaining gaps: pre-gaps for reqs that still have failing or missing tests
  const remainingGaps = preGaps.filter(g => {
    if (g.gapType === 'no_test_mapped') return untestedRequirements.some(r => r.id === g.requirementId);
    const relatedScenarios = scenarios.filter(s => s.requirementId === g.requirementId);
    return relatedScenarios.some(s => !s.passed);
  });

  const totalReqs = requirements.requirements.length;
  const covered = ALL_TYPES.reduce((n, t) => n + byCategory[t].covered, 0);
  const coverageScore = pct(covered, totalReqs);

  const verdict: PostExecutionCoverageReport['verdict'] =
    coverageScore === 100 ? 'FULL' :
    coverageScore >= 70  ? 'PARTIAL' :
                           'INSUFFICIENT';

  return {
    storyId: requirements.storyId,
    totalRequirements: totalReqs,
    testedRequirements: covered,
    untestedRequirements,
    byCategory,
    scenarios,
    remainingGaps,
    coverageScore,
    verdict,
  };
}
