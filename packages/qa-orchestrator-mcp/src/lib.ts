// Programmatic API, for scripts and CI that want the orchestrators without MCP.
export { loadConfig, resolveStory, type ProjectConfig } from './core/config';
export { createServer, VERSION } from './server';
export { planStory, runApiOrchestrator, reviewPlannedStory } from './api/orchestrator';
export { recordDecision } from './api/agents/human-review';
export {
  analyzeStory, saveTestCases, scanFramework, generateSpec, executeSpec, classifyFailures,
  healTimingFailures, writeReport,
} from './ui/stages';
