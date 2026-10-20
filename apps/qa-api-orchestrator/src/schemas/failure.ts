export type FailureCategory =
  | 'APPLICATION_BUG'
  | 'TEST_BUG'
  | 'TEST_DATA_ISSUE'
  | 'API_CONTRACT_CHANGE'
  | 'AUTHENTICATION_FAILURE'
  | 'ENVIRONMENT_FAILURE'
  | 'TIMEOUT'
  | 'FLAKY_TEST';

export interface FailedTest {
  title: string;
  error: string;
  expected?: string;
  actual?: string;
}

export interface ExecutionResult {
  total: number;
  passed: number;
  failed: number;
  duration: number;
  failures: FailedTest[];
  rawOutput: string;
}

export interface FailureAnalysis {
  testTitle: string;
  category: FailureCategory;
  confidence: number;
  rootCause: string;
  healable: boolean;
  proposedFix?: string;
}

export interface AnalysisResult {
  failures: FailureAnalysis[];
  anyHealable: boolean;
}
