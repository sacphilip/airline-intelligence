export interface TestCase {
  id: string;
  name: string;
  description: string;
  endpoint: string;
  method: string;
  queryParams?: Record<string, string>;
  requestBody?: Record<string, unknown>;
  expectedStatus: number;
  expectedFields?: string[];
  expectedErrorMessage?: string;
  /** Fields that must NOT appear in the response body (AC-05: no password leakage) */
  forbiddenResponseFields?: string[];
  /** Response headers that must be present and contain the given substring */
  expectedResponseHeaders?: Record<string, string>;
  requirementId: string;
}

export interface TestDesign {
  storyId: string;
  testCases: TestCase[];
}
