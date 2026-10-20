export type RequirementType = 'functional' | 'negative' | 'validation' | 'schema';

export interface Requirement {
  id: string;
  description: string;
  type: RequirementType;
}

export interface RequirementAnalysis {
  storyId: string;
  title: string;
  requirements: Requirement[];
}
