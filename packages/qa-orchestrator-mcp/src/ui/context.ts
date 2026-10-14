import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { ProjectConfig, inProject } from '../core/config';

export type UiRequirementType = 'functional' | 'negative' | 'boundary' | 'ui' | 'state';

export interface UiRequirement { id: string; description: string; type: UiRequirementType }

export interface UiTestCase {
  id: string;
  requirement: string;
  scenario: string;
  preconditions?: string;
  testData?: string;
  steps?: string[];
  expected?: string;
  type?: 'Functional' | 'Negative' | 'Boundary' | 'UI' | 'State' | 'Regression';
  priority?: 'P0' | 'P1' | 'P2' | 'P3';
  automation: boolean;
  automationStrategy?: 'UI' | 'API' | 'UI+API' | 'MANUAL' | 'NOT_AUTOMATABLE';
  reason?: string;
}

export type FailureClassification =
  | 'ENVIRONMENT_FAILURE' | 'TIMING_SYNCHRONIZATION' | 'LOCATOR_FAILURE' | 'TEST_DATA_FAILURE'
  | 'NETWORK_API_FAILURE' | 'PRODUCT_DEFECT' | 'TEST_DEFECT' | 'UNKNOWN';

export interface UiContext {
  storyId: string;
  /** Project-relative path to the story. */
  storyFile: string;
  status: 'PENDING' | 'REQUIREMENTS_DONE' | 'TEST_DESIGN_DONE' | 'FRAMEWORK_DISCOVERED' | 'AUTOMATION_DONE' | 'EXECUTING' | 'PASS' | 'FAIL' | 'BLOCKED';
  requirements: UiRequirement[];
  testCases: UiTestCase[];
  frameworkDiscovery: Record<string, unknown>;
  automatedTests: { testCaseId: string; file: string; status: 'created' | 'modified' | 'reused' }[];
  executionResults: { testId: string; result: 'PASS' | 'FAIL' | 'SKIP'; duration: number; error?: string; screenshot?: string; trace?: string }[];
  failures: { testId: string; classification: FailureClassification; rootCause: string; evidence: string; action: 'HEAL' | 'REPORT_DEFECT' | 'INVESTIGATE' }[];
  healingAttempts: { testId: string; attempt: number; change: string; reason: string; result: 'PENDING' | 'PASS' | 'FAIL' | 'NEEDS_LLM' | 'UNRESOLVED' }[];
  defects: unknown[];
}

export function contextPath(cfg: ProjectConfig, storyId: string): string {
  return inProject(cfg, cfg.outputDir, 'ui', `${storyId}.context.json`);
}

export function loadContext(cfg: ProjectConfig, storyId: string): UiContext {
  const file = contextPath(cfg, storyId);
  if (!existsSync(file)) throw new Error(`No UI context for ${storyId}. Run qa_ui_analyze_story first.`);
  return JSON.parse(readFileSync(file, 'utf-8'));
}

export function saveContext(cfg: ProjectConfig, ctx: UiContext): string {
  const file = contextPath(cfg, ctx.storyId);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(ctx, null, 2) + '\n', 'utf-8');
  return file;
}

export const reportPath = (cfg: ProjectConfig, storyId: string) => join(inProject(cfg, cfg.outputDir, 'ui', 'reports'), `${storyId}-report.md`);
