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
  requirementId: string;
}

export interface TestDesign {
  storyId: string;
  testCases: TestCase[];
}
