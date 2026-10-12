import { RequirementAnalysis } from '../schemas/requirements';
import { ApiContract } from '../schemas/api-contract';
import { TestCase, TestDesign } from '../schemas/test-case';

// Extract example param values from the user story markdown
function extractExamples(storyContent: string): Record<string, string> {
  const examples: Record<string, string> = {};

  // Inline code values like `6E 5321`, `BLR`, `DEL`, `2026-09-30`
  const codeVals = [...storyContent.matchAll(/`([^`]+)`/g)].map(m => m[1]);

  for (const v of codeVals) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { examples['date'] ??= v; continue; }
    if (/^[A-Z]{2}\s?\d{3,4}$/.test(v)) { examples['number'] ??= v.replace(' ', ''); continue; }
    if (/^[A-Z]{3,4}$/.test(v) && !examples['from']) { examples['from'] = v; continue; }
    if (/^[A-Z]{3,4}$/.test(v) && !examples['to']) { examples['to'] = v; continue; }
    if (/^[A-Z]{2}$/.test(v)) { examples['iata'] ??= v; continue; }
  }

  // Sensible defaults so every endpoint always has values
  examples['date'] ??= new Date().toISOString().slice(0, 10);
  examples['number'] ??= '6E5321';
  examples['from'] ??= 'BLR';
  examples['to'] ??= 'DEL';
  examples['iata'] ??= '6E';
  examples['days'] ??= '7';
  examples['airport'] ??= 'DEL';

  return examples;
}

export function designTests(
  requirements: RequirementAnalysis,
  apiContract: ApiContract,
  storyContent: string,
): TestDesign {
  const ex = extractExamples(storyContent);
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
