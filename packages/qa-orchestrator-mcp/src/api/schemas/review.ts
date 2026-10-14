// Human review of the test plan, taken after pre-test coverage analysis and
// before any test is generated or run.

/**
 * How the decision was recorded:
 * - elicit: the MCP client asked the user directly
 * - file:   recorded in the review JSON (by the qa_api_review tool or by hand)
 * - auto:   review skipped; kept visible in reports as auto-approved
 */
export type ReviewMode = 'elicit' | 'file' | 'auto';

export type ReviewDecision = 'approve' | 'reject';

export interface ReviewRecord {
  mode: ReviewMode;
  decision: ReviewDecision;
  /** Test case IDs the reviewer dropped from the plan. */
  excludedTestCaseIds: string[];
  reviewer: string;
  comment: string;
  reviewedAt: string;
  /** Hash of the plan that was reviewed, so a decision can't be applied to a changed plan. */
  planHash: string;
}

/** The JSON file that holds the decision for one story's plan. */
export interface ReviewDecisionFile {
  storyId: string;
  planHash: string;
  /** "pending" until a person decides. */
  decision: ReviewDecision | 'pending';
  excludedTestCaseIds: string[];
  reviewer: string;
  comment: string;
  /** How the decision was recorded (absent while pending). */
  recordedVia?: 'elicit' | 'file';
  /** The plan's test case IDs, for validating exclusions. */
  testCaseIds: string[];
}
