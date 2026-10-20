import { RequirementAnalysis } from '../schemas/requirements';
import { ApiContract, ApiEndpoint, BodyField, QueryParam } from '../schemas/api-contract';

export function discoverApi(
  requirements: RequirementAnalysis,
  openApiSchema: Record<string, unknown>,
  storyContent: string,
  baseUrl: string,
): ApiContract {
  // Pull endpoint paths from the story's ## Implementation section
  const implSection = storyContent.match(/##\s*implementation[\s\S]*?(?=\n##|$)/i)?.[0] ?? '';
  const hintPaths = [...implSection.matchAll(/`(?:GET|POST|PUT|DELETE)\s+([/\w{}]+)/gi)].map(
    m => m[1].split('?')[0],
  );

  const schemaPaths = ((openApiSchema as Record<string, unknown>).paths ?? {}) as Record<
    string,
    Record<string, unknown>
  >;

  const endpoints: ApiEndpoint[] = [];

  for (const [path, pathItem] of Object.entries(schemaPaths)) {
    const relevant =
      hintPaths.length === 0 || hintPaths.some(h => path === h || path.startsWith(h));
    if (!relevant) continue;

    for (const [method, op] of Object.entries(pathItem)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
      const operation = op as Record<string, unknown>;
      const params = (operation.parameters as Record<string, unknown>[] | undefined) ?? [];

      const queryParams: QueryParam[] = params
        .filter(p => p['in'] === 'query')
        .map(p => ({
          name: p['name'] as string,
          required: (p['required'] as boolean) ?? false,
          type: ((p['schema'] as Record<string, unknown> | undefined)?.['type'] as string) ?? 'string',
          description: p['description'] as string | undefined,
        }));

      // Extract required fields from request body schema
      const requestBody = operation['requestBody'] as Record<string, unknown> | undefined;
      const bodySchema = (
        ((requestBody?.['content'] as Record<string, unknown>)?.['application/json'] as Record<string, unknown>)?.['schema'] as Record<string, unknown>
      ) ?? {};
      const bodyRequired = new Set<string>((bodySchema['required'] as string[] | undefined) ?? []);
      const bodyProperties = (bodySchema['properties'] as Record<string, Record<string, unknown>>) ?? {};
      const bodyFields: BodyField[] = Object.entries(bodyProperties).map(([name, prop]) => ({
        name,
        required: bodyRequired.has(name),
        type: (prop['type'] as string) ?? 'string',
      }));

      endpoints.push({
        method: method.toUpperCase(),
        path,
        summary: (operation['summary'] as string) ?? `${method.toUpperCase()} ${path}`,
        queryParams,
        bodyFields,
        responseDescription: '200 JSON response',
        requirementIds: requirements.requirements.map(r => r.id),
      });
    }
  }

  return { baseUrl, endpoints, rawSchema: openApiSchema };
}
