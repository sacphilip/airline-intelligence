import { RequirementAnalysis } from './requirements';
import { ApiContract } from './api-contract';
import { TestDesign } from './test-case';
import { ExecutionResult, AnalysisResult } from './failure';
import { PreTestCoverageAnalysis, PostExecutionCoverageReport } from './coverage';
import { ReviewRecord } from './review';

export interface OrchestratorState {
  storyPath: string;
  storyContent: string;
  storyId: string;
  requirements?: RequirementAnalysis;
  apiContract?: ApiContract;
  testDesign?: TestDesign;
  preCoverage?: PreTestCoverageAnalysis;
  review?: ReviewRecord;
  /** Set when the run stopped at the coverage gate: waiting for a human to approve or revise. */
  stoppedAtCoverage?: 'awaiting';
  /** Set when the run stopped at the review gate: waiting for a decision, or rejected. */
  stoppedAtReview?: 'awaiting' | 'rejected';
  /** Where the pending review lives, when stopped at the review gate. */
  pendingReview?: { reason: string; packetPath: string; decisionPath: string; packet: string };
  generatedTestPath?: string;
  firstRun?: ExecutionResult;
  analysis?: AnalysisResult;
  healAttempted: boolean;
  finalRun?: ExecutionResult;
  coverageReport?: PostExecutionCoverageReport;
}
