#!/usr/bin/env node
import 'dotenv/config';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { runOrchestrator } from './orchestrator/qa-api-orchestrator';

const storyArg = process.argv[2];

if (!storyArg) {
  console.error('Usage: npm run qa <path-to-user-story.md>');
  console.error('Example: npm run qa ../../user-stories/US-001-search-by-flight-number.md');
  process.exit(1);
}

const storyPath = resolve(process.cwd(), storyArg);

if (!existsSync(storyPath)) {
  console.error(`User story not found: ${storyPath}`);
  process.exit(1);
}

runOrchestrator(storyPath)
  .then(state => {
    const run = state.finalRun ?? state.firstRun;
    process.exit(run && run.failed > 0 ? 1 : 0);
  })
  .catch((err: unknown) => {
    console.error('Orchestrator error:', err);
    process.exit(2);
  });
