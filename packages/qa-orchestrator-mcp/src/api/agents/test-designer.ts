import { RequirementAnalysis } from '../schemas/requirements';
import { ApiContract } from '../schemas/api-contract';
import { TestCase, TestDesign } from '../schemas/test-case';

// Example query-parameter values, in priority order:
//   1. the project config (`api.examples` in qa-orchestrator.config.json)
//   2. the story itself: inline `name=value` / `name: value` code spans, e.g. `number=6E5321`
//   3. generic defaults by parameter name (dates get today's date)
// Anything still missing falls back to "test" where the value is used.
function extractExamples(storyContent: string, configured: Record<string, string>): Record<string, string> {
  const examples: Record<string, string> = { ...configured };

  for (const [, name, value] of storyContent.matchAll(/`(\w+)\s*[=:]\s*([^`]+?)`/g)) {
    examples[name] ??= value.trim();
  }

  const today = new Date().toISOString().slice(0, 10);
  examples['date'] ??= today;
  examples['startDate'] ??= today;
  examples['endDate'] ??= today;
  examples['days'] ??= '7';
  examples['limit'] ??= '10';
  examples['page'] ??= '1';

  return examples;
}

export function designTests(
  requirements: RequirementAnalysis,
  apiContract: ApiContract,
  storyContent: string,
  configuredExamples: Record<string, string> = {},
): TestDesign {
  const ex = extractExamples(storyContent, configuredExamples);
  const storyNum = requirements.storyId.replace(/^US-/, '');
  const testCases: TestCase[] = [];
  let tcIndex = 1;

  const tc = (): string => `TC-${storyNum}-${String(tcIndex++).padStart(2, '0')}`;

  for (const endpoint of apiContract.endpoints) {
    const requiredParams = endpoint.queryParams.filter(p => p.required);
    const allParams: Record<string, string> = {};
    for (const p of endpoint.queryParams) {
      allParams[p.name] = ex[p.name] ?? 'test';
    }

    // Negative: one test per missing required param
    for (const param of requiredParams) {
      const params = { ...allParams };
      delete params[param.name];
      testCases.push({
        id: tc(),
        name: `missing ${param.name} returns 400`,
        description: `Omitting required param '${param.name}' must return HTTP 400`,
        endpoint: endpoint.path,
        method: endpoint.method,
        queryParams: params,
        expectedStatus: 400,
        requirementId:
          requirements.requirements.find(r => r.type === 'negative')?.id ??
          requirements.requirements[0].id,
      });
    }

    // Validation: invalid value for params that have known format rules
    for (const param of endpoint.queryParams) {
      const invalidValue = invalidFor(param.name);
      if (!invalidValue) continue;
      testCases.push({
        id: tc(),
        name: `invalid ${param.name} returns 400`,
        description: `Sending an invalid value for '${param.name}' must return HTTP 400`,
        endpoint: endpoint.path,
        method: endpoint.method,
        queryParams: { ...allParams, [param.name]: invalidValue },
        expectedStatus: 400,
        requirementId:
          requirements.requirements.find(r => r.type === 'validation' || r.type === 'negative')
            ?.id ?? requirements.requirements[0].id,
      });
    }

    // Functional: happy-path — response without server error
    testCases.push({
      id: tc(),
      name: `valid request resolves`,
      description: `Valid request to ${endpoint.method} ${endpoint.path} returns a non-5xx status`,
      endpoint: endpoint.path,
      method: endpoint.method,
      queryParams: requiredParams.length > 0 ? allParams : undefined,
      expectedStatus: 200,
      requirementId:
        requirements.requirements.find(r => r.type === 'functional')?.id ??
        requirements.requirements[0].id,
    });

    // Schema: response body structure
    if (endpoint.queryParams.length > 0) {
      testCases.push({
        id: tc(),
        name: `response is valid JSON`,
        description: `${endpoint.method} ${endpoint.path} returns parseable JSON on success`,
        endpoint: endpoint.path,
        method: endpoint.method,
        queryParams: requiredParams.length > 0 ? allParams : undefined,
        expectedStatus: 200,
        requirementId:
          requirements.requirements.find(r => r.type === 'schema')?.id ??
          requirements.requirements[0].id,
      });
    }
  }

  return { storyId: requirements.storyId, testCases };
}

function invalidFor(paramName: string): string | null {
  const rules: Record<string, string> = {
    date: 'not-a-date',
    number: 'TOOLONGNOTVALID12345',
    from: 'X',       // too short — must be 3-4 chars
    to: 'X',
    iata: '12345',   // too long / invalid format
    lat: 'abc',
    lon: 'abc',
    dist: '-999',
  };
  return rules[paramName] ?? null;
}
