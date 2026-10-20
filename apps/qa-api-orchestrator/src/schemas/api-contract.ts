export interface QueryParam {
  name: string;
  required: boolean;
  type: string;
  description?: string;
}

export interface BodyField {
  name: string;
  required: boolean;
  type: string;
}

export interface ApiEndpoint {
  method: string;
  path: string;
  summary: string;
  queryParams: QueryParam[];
  bodyFields: BodyField[];
  responseDescription: string;
  requirementIds: string[];
}

export interface ApiContract {
  baseUrl: string;
  endpoints: ApiEndpoint[];
  rawSchema: Record<string, unknown>;
}
