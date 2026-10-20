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
    const requiredBodyFields = (endpoint.bodyFields ?? []).filter(f => f.required);
    const negReqId = requirements.requirements.find(r => r.type === 'negative')?.id ?? requirements.requirements[0].id;
    const valReqId = requirements.requirements.find(r => r.type === 'validation' || r.type === 'negative')?.id ?? requirements.requirements[0].id;
    const funcReqId = requirements.requirements.find(r => r.type === 'functional')?.id ?? requirements.requirements[0].id;
    const schemaReqId = requirements.requirements.find(r => r.type === 'schema')?.id ?? requirements.requirements[0].id;

    // Negative: one test per missing required query param
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
        requirementId: negReqId,
      });
    }

    // Negative: one test per missing required body field
    for (const field of requiredBodyFields) {
      testCases.push({
        id: tc(),
        name: `missing body field '${field.name}' returns 400`,
        description: `Omitting required body field '${field.name}' must return HTTP 400`,
        endpoint: endpoint.path,
        method: endpoint.method,
        expectedStatus: 400,
        requirementId: negReqId,
      });
    }

    // Negative: login-specific — wrong credentials return 401
    if (endpoint.path.endsWith('/login') && endpoint.method === 'POST') {
      testCases.push({
        id: tc(),
        name: `wrong credentials return 401`,
        description: `Submitting an incorrect email/password must return HTTP 401`,
        endpoint: endpoint.path,
        method: endpoint.method,
        expectedStatus: 401,
        requirementId: negReqId,
      });
      // AC-05: response body must not expose password or secret fields
      testCases.push({
        id: tc(),
        name: `login response must not expose password fields`,
        description: `Successful login response body must not contain password, passwordHash, or any secret`,
        endpoint: endpoint.path,
        method: endpoint.method,
        expectedStatus: 200,
        forbiddenResponseFields: ['password', 'passwordHash', 'password_hash', 'secret'],
        requirementId: funcReqId,
      });
      // AC-07: Set-Cookie header must have Max-Age for 30-day session
      testCases.push({
        id: tc(),
        name: `Set-Cookie header includes Max-Age for 30-day session`,
        description: `Login response Set-Cookie must include Max-Age=2592000 (30 days in seconds)`,
        endpoint: endpoint.path,
        method: endpoint.method,
        expectedStatus: 200,
        expectedResponseHeaders: { 'set-cookie': 'max-age=2592000' },
        requirementId: funcReqId,
      });
    }

    // Validation: invalid value for query params that have known format rules
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
        requirementId: valReqId,
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
      requirementId: funcReqId,
    });

    // Schema: response body structure (always — not gated on query params)
    testCases.push({
      id: tc(),
      name: `response is valid JSON`,
      description: `${endpoint.method} ${endpoint.path} returns parseable JSON on success`,
      endpoint: endpoint.path,
      method: endpoint.method,
      queryParams: requiredParams.length > 0 ? allParams : undefined,
      expectedStatus: 200,
      requirementId: schemaReqId,
    });
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
