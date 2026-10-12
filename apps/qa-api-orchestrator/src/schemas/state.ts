import { RequirementAnalysis } from './requirements';
import { ApiContract } from './api-contract';
import { TestDesign } from './test-case';
import { ExecutionResult, AnalysisResult } from './failure';
import { PreTestCoverageAnalysis, PostExecutionCoverageReport } from './coverage';

export interface OrchestratorState {
  storyPath: string;
  storyContent: string;
  storyId: string;
  requirements?: RequirementAnalysis;
  apiContract?: ApiContract;
  testDesign?: TestDesign;
  preCoverage?: PreTestCoverageAnalysis;
  generatedTestPath?: string;
  firstRun?: ExecutionResult;
  analysis?: AnalysisResult;
  healAttempted: boolean;
  finalRun?: ExecutionResult;
  coverageReport?: PostExecutionCoverageReport;
}
