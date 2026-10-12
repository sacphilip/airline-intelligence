import { Requirement, RequirementType } from './requirements';

export interface CoverageGap {
  requirementId: string;
  requirementDescription: string;
  requirementType: RequirementType;
  gapType:
    | 'no_test_mapped'
    | 'no_negative_counterpart'
    | 'no_schema_assertion'
    | 'no_validation_boundary';
  recommendation: string;
}

export interface CategoryCoverage {
  total: number;
  covered: number;
  percent: number;
}

export interface PreTestCoverageAnalysis {
  totalRequirements: number;
  coveredRequirements: number;
  coveragePercent: number;
  byCategory: Record<RequirementType, CategoryCoverage>;
  gaps: CoverageGap[];
}

export interface CoveredScenario {
  testCaseId: string;
  testName: string;
  category: RequirementType;
  requirementId: string;
  requirementDescription: string;
  passed: boolean;
  failureReason?: string;
}

export interface PostExecutionCoverageReport {
  storyId: string;
  totalRequirements: number;
  testedRequirements: number;
  untestedRequirements: Requirement[];
  byCategory: Record<RequirementType, CategoryCoverage>;
  scenarios: CoveredScenario[];
  remainingGaps: CoverageGap[];
  coverageScore: number;
  verdict: 'FULL' | 'PARTIAL' | 'INSUFFICIENT';
}
