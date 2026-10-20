#!/usr/bin/env node
import 'dotenv/config';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { runOrchestrator } from './orchestrator/qa-api-orchestrator';
import { resolveReviewMode } from './agents/human-review';
import type { ReviewMode } from './schemas/review';

// Exit codes
const EXIT = {
  PASSED: 0,
  TESTS_FAILED: 1,
  ERROR: 2,
  AWAITING_REVIEW: 3, // test plan written for review; record a decision and run again
  REVIEW_REJECTED: 4, // reviewer rejected the test plan; nothing was generated
} as const;

function usage(): never {
  console.error('Usage: npm run qa <path-to-user-story.md> [--review=interactive|file|auto] [--mock]');
  console.error('Example: npm run qa ../../user-stories/US-001-search-by-flight-number.md');
  console.error('');
  console.error('--review  How the test plan is reviewed before tests are generated (or set QA_REVIEW):');
  console.error('            interactive  prompt in this terminal (default when run in a terminal)');
  console.error('            file         write reports/review/<ID>-review.{md,json}, stop with exit code 3,');
  console.error('                         and continue on the next run once a decision is recorded');
  console.error('                         (default without a terminal, e.g. agents and CI)');
  console.error('            auto         skip the review (recorded as auto-approved)');
  console.error('');
  console.error('--mock    Start a lightweight mock backend on port $MOCK_PORT (default 3199) instead of');
  console.error('          connecting to a real backend. Useful before the backend is implemented.');
  process.exit(EXIT.ERROR);
}

const args = process.argv.slice(2);
let reviewFlag: string | undefined;
let useMock = false;
const positional: string[] = [];
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--help' || arg === '-h') usage();
  else if (arg.startsWith('--review=')) reviewFlag = arg.slice('--review='.length);
  else if (arg === '--review') reviewFlag = args[++i];
  else if (arg === '--mock') useMock = true;
  else positional.push(arg);
}

const storyArg = positional[0];
if (!storyArg) usage();

const storyPath = resolve(process.cwd(), storyArg);
if (!existsSync(storyPath)) {
  console.error(`User story not found: ${storyPath}`);
  process.exit(EXIT.ERROR);
}

let reviewMode: ReviewMode;
try {
  reviewMode = resolveReviewMode(reviewFlag);
} catch (err) {
  console.error((err as Error).message);
  process.exit(EXIT.ERROR);
}

async function main(): Promise<void> {
  let stopMock: (() => Promise<void>) | undefined;

  if (useMock) {
    // Dynamic import so the mock-server module is not loaded in normal runs
    const { startMockServer } = await import('./mock-server');
    const mockPort = parseInt(process.env.MOCK_PORT ?? '3199', 10);
    const mock = await startMockServer(mockPort);
    // Point both the schema fetcher and the test runner at the mock server
    process.env.API_BASE_URL = mock.url;
    process.env.OPENAPI_URL  = `${mock.url}/api-docs-json`;
    stopMock = mock.stop;
  }

  try {
    const state = await runOrchestrator(storyPath, { reviewMode });
    if (state.stoppedAtReview === 'awaiting') process.exit(EXIT.AWAITING_REVIEW);
    if (state.stoppedAtReview === 'rejected')  process.exit(EXIT.REVIEW_REJECTED);
    const run = state.finalRun ?? state.firstRun;
    process.exit(run && run.failed > 0 ? EXIT.TESTS_FAILED : EXIT.PASSED);
  } finally {
    await stopMock?.();
  }
}

main().catch((err: unknown) => {
  console.error('Orchestrator error:', err);
  process.exit(EXIT.ERROR);
});
