import { RequirementAnalysis, Requirement, RequirementType } from '../schemas/requirements';

export function analyzeRequirements(storyContent: string, storyId: string): RequirementAnalysis {
  const lines = storyContent.split('\n');
  const title = lines.find(l => l.startsWith('# '))?.replace(/^#\s*/, '').trim() ?? storyId;

  const criteriaStart = lines.findIndex(l => /^##\s+acceptance criteria/i.test(l));
  // Use /^## [^#]/ so ### sub-headings inside the section don't truncate the slice
  const criteriaEnd = lines.findIndex((l, i) => i > criteriaStart && /^## [^#]/.test(l));
  const criteriaLines = lines
    .slice(criteriaStart + 1, criteriaEnd === -1 ? undefined : criteriaEnd)
    .filter(l => /^\s*[-*]/.test(l));

  const prefix = storyId.replace(/^US-/, '');
  const requirements: Requirement[] = criteriaLines.map((line, i) => ({
    id: `REQ-${prefix}-${String(i + 1).padStart(2, '0')}`,
    description: line.replace(/^\s*[-*]\s*/, '').trim(),
    type: classify(line),
  }));

  if (!requirements.some(r => r.type === 'negative')) {
    requirements.push({
      id: `REQ-${prefix}-${String(requirements.length + 1).padStart(2, '0')}`,
      description: 'Missing required parameters must return HTTP 400',
      type: 'negative',
    });
  }
  if (!requirements.some(r => r.type === 'schema')) {
    requirements.push({
      id: `REQ-${prefix}-${String(requirements.length + 1).padStart(2, '0')}`,
      description: 'Response body must be valid JSON with documented fields',
      type: 'schema',
    });
  }

  return { storyId, title, requirements };
}

function classify(line: string): RequirementType {
  const l = line.toLowerCase();
  if (/invalid|error|missing|reject|fail/i.test(l)) return 'negative';
  if (/format|validat|boundary|type|pattern/i.test(l)) return 'validation';
  if (/schema|field|structure|json|array/i.test(l)) return 'schema';
  return 'functional';
}
