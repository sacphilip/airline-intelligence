// Human review of the test plan, taken after pre-test coverage analysis and
// before any test is generated or run.

/**
 * How the review is taken:
 * - interactive: prompt in the terminal (default when stdin is a TTY)
 * - file:        write a review packet and stop; a person records the decision in
 *                the packet's JSON file and the orchestrator is run again
 *                (default when there is no TTY, e.g. when run by an agent or in CI)
 * - auto:        skip the review; recorded as auto-approved so it stays visible
 */
export type ReviewMode = 'interactive' | 'file' | 'auto';

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

/** The JSON file a reviewer edits in file mode. */
export interface ReviewDecisionFile {
  storyId: string;
  planHash: string;
  /** "pending" until a person fills it in. */
  decision: ReviewDecision | 'pending';
  excludedTestCaseIds: string[];
  reviewer: string;
  comment: string;
  /** Read-only context for the reviewer; ignored when the decision is read back. */
  testCaseIds: string[];
}
