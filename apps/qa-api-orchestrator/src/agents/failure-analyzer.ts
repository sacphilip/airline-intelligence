import { ExecutionResult, AnalysisResult, FailureAnalysis, FailureCategory } from '../schemas/failure';

export function analyzeFailures(result: ExecutionResult): AnalysisResult {
  if (result.failures.length === 0) return { failures: [], anyHealable: false };

  const failures: FailureAnalysis[] = result.failures.map(f => {
    const errText = `${f.error} ${f.expected ?? ''} ${f.actual ?? ''}`.toLowerCase();
    const expected = f.expected ?? '';
    const actual = f.actual ?? '';
    let category: FailureCategory = 'APPLICATION_BUG';
    let confidence = 70;
    let rootCause = f.error.split('\n')[0];
    let healable = false;
    let proposedFix: string | undefined;

    if (/econnrefused|network|etimedout/.test(errText)) {
      category = 'ENVIRONMENT_FAILURE';
      confidence = 95;
      rootCause = 'Backend not reachable — check that the server is running on port 3100';
    } else if (expected === '400' && /2\d\d/.test(actual)) {
      // Test expected a 400 but got a 2xx — param is likely optional not required
      category = 'TEST_BUG';
      confidence = 85;
      rootCause = `Test expected 400 but got ${actual} — the parameter may be optional on this endpoint`;
      healable = true;
      proposedFix = 'Change assertion to expect([200, 404]).toContain(res.status()) since the param is optional';
    } else if (expected === '200' && actual === '400') {
      category = 'TEST_BUG';
      confidence = 75;
      rootCause = 'Test expected 200 but got 400 — check the query params being sent';
      healable = true;
      proposedFix = 'Fix the request params in the test to match what the endpoint requires';
    } else if (expected === '200' && actual === '404') {
      category = 'TEST_DATA_ISSUE';
      confidence = 80;
      rootCause = 'No matching data in the database for the test params';
      healable = true;
      proposedFix = 'Change assertion to expect([200, 404]).toContain(res.status()) to tolerate absent data';
    } else if (/5\d\d/.test(actual)) {
      category = 'APPLICATION_BUG';
      confidence = 90;
      rootCause = `Server returned ${actual} — backend threw an unhandled error`;
    } else if (/property.*undefined|cannot read|typeerror/.test(errText)) {
      category = 'TEST_BUG';
      confidence = 75;
      rootCause = 'Test tried to access a field that does not exist on the response';
      healable = true;
      proposedFix = 'Guard field access with optional chaining (?.field) or add a status check before asserting fields';
    }

    return {
      testTitle: f.title,
      category,
      confidence,
      rootCause,
      healable,
      ...(proposedFix ? { proposedFix } : {}),
    };
  });

  return { failures, anyHealable: failures.some(f => f.healable) };
}
