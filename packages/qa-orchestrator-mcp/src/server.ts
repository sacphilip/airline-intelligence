import { existsSync, readdirSync, readFileSync } from 'fs';
import { basename, join, relative } from 'path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema, CallToolResult, GetPromptRequestSchema, ListPromptsRequestSchema,
  ListToolsRequestSchema, Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { ProjectConfig, loadConfig, resolveStory, storyIdOf, inProject, CONFIG_FILE } from './core/config';
import { captureLog } from './core/logger';
import { browserInstalled, installBrowsers, resolvePlaywright } from './core/playwright';
import { BrowserBridge } from './core/browser';
import { planStory, reviewDirOf, reviewPlannedStory, runApiOrchestrator } from './api/orchestrator';
import { recordDecision } from './api/agents/human-review';
import { coverageGatePacket, recordCoverageDecision } from './api/agents/coverage-gate';
import { OrchestratorState } from './api/schemas/state';
import {
  analyzeStory, classifyFailures, executeSpec, generateSpec, healTimingFailures, saveTestCases,
  scanFramework, writeReport,
} from './ui/stages';
import { UiTestCase, loadContext, saveContext } from './ui/context';

export const VERSION = '0.1.0';
const PROMPTS_DIR = join(__dirname, '..', 'prompts');

// ── Tool definitions ──────────────────────────────────────────────────────────

const root = { projectRoot: { type: 'string', description: `Project root. Default: QA_PROJECT_ROOT or the server's working directory.` } };
const story = { story: { type: 'string', description: 'User story: an ID ("US-001" or "1"), a file name, or a path.' } };
const obj = (properties: Record<string, unknown>, required: string[] = []) =>
  ({ type: 'object' as const, properties: { ...properties, ...root }, required });

const TOOLS: Tool[] = [
  {
    name: 'qa_status',
    description: 'Show the resolved project config, where Playwright will run from, and whether the built-in browser tools are available.',
    inputSchema: obj({}),
  },
  {
    name: 'qa_install_browsers',
    description: 'Download the browser build Playwright needs to run tests (Chromium by default; ~150 MB). Only when the user agrees or asks.',
    inputSchema: obj({ browsers: { type: 'array', items: { type: 'string', enum: ['chromium', 'firefox', 'webkit'] } } }),
  },
  {
    name: 'qa_list_stories',
    description: 'List the user stories (markdown files) in the project\'s stories folder.',
    inputSchema: obj({}),
  },
  // API orchestrator
  {
    name: 'qa_api_plan',
    description: 'API tests, step 1: parse the story, map its endpoints from the OpenAPI schema, design test cases and analyse coverage gaps. Writes a review packet; generates nothing. Show the plan to the user, then record their decision with qa_api_review.',
    inputSchema: obj(story, ['story']),
  },
  {
    name: 'qa_api_coverage_review',
    description: 'API tests, step 1b: record the HUMAN reviewer\'s decision on the coverage gap analysis. Call this after showing the user the coverage gaps from qa_api_plan. Never decide on their behalf. "proceed" moves to the full plan review; "revise" stops the pipeline so gaps can be addressed.',
    inputSchema: obj({
      ...story,
      decision: { type: 'string', enum: ['proceed', 'revise'] },
      reviewer: { type: 'string', description: 'The person who decided.' },
      notes: { type: 'string', description: 'Optional notes about the decision or gaps to address.' },
    }, ['story', 'decision', 'reviewer']),
  },
  {
    name: 'qa_api_review',
    description: 'Record the HUMAN reviewer\'s decision on a planned test suite. Only call this with an answer the user explicitly gave — never decide yourself. Approve (optionally excluding test case IDs) or reject (comment required).',
    inputSchema: obj({
      ...story,
      decision: { type: 'string', enum: ['approve', 'reject'] },
      reviewer: { type: 'string', description: 'The person who decided.' },
      comment: { type: 'string', description: 'Required when rejecting.' },
      excludedTestCaseIds: { type: 'array', items: { type: 'string' }, description: 'Test cases to drop (approve only).' },
    }, ['story', 'decision', 'reviewer']),
  },
  {
    name: 'qa_api_run',
    description: 'API tests, full pipeline: plan, human review gate, generate the Playwright spec, run it against the API, heal test-side failures, re-run and report coverage. Stops at the review gate until the plan is approved (asks the user directly if the client supports elicitation).',
    inputSchema: obj({ ...story, skipReview: { type: 'boolean', description: 'Skip the human review. Only when the user explicitly asks.' } }, ['story']),
  },
  // UI orchestrator
  {
    name: 'qa_ui_analyze_story',
    description: 'UI tests, stage 1: extract and classify acceptance criteria from the story. Starts a fresh UI context for the story.',
    inputSchema: obj(story, ['story']),
  },
  {
    name: 'qa_ui_save_test_cases',
    description: 'UI tests, stage 2: save the test cases you designed (see the qa-ui-test-design prompt). Validates IDs and requirement links.',
    inputSchema: obj({
      ...story,
      testCases: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' }, requirement: { type: 'string' }, scenario: { type: 'string' },
            preconditions: { type: 'string' }, testData: { type: 'string' }, steps: { type: 'array', items: { type: 'string' } },
            expected: { type: 'string' }, type: { type: 'string' }, priority: { type: 'string' },
            automation: { type: 'boolean' }, automationStrategy: { type: 'string' }, reason: { type: 'string' },
          },
          required: ['id', 'requirement', 'scenario', 'automation'],
        },
      },
    }, ['story', 'testCases']),
  },
  {
    name: 'qa_ui_scan_framework',
    description: 'UI tests, stage 3: inventory existing page objects, fixtures, test data and specs to reuse.',
    inputSchema: obj(story, ['story']),
  },
  {
    name: 'qa_ui_generate_spec',
    description: 'UI tests, stage 4a: write a base spec with one stub per automatable test case (TODO: [MCP-ENRICH] + test.fixme). Enrich it next with the browser tools.',
    inputSchema: obj({ ...story, overwrite: { type: 'boolean', description: 'Replace an existing spec for this story.' } }, ['story']),
  },
  {
    name: 'qa_ui_run_spec',
    description: 'UI tests, stages 5/8: run the story\'s spec with the project\'s own Playwright config and record per-test results.',
    inputSchema: obj(story, ['story']),
  },
  {
    name: 'qa_ui_classify_failures',
    description: 'UI tests, stage 6a: classify failures by error pattern. UNKNOWN ones need your diagnosis (qa-ui-failure-analysis prompt).',
    inputSchema: obj(story, ['story']),
  },
  {
    name: 'qa_ui_update_failures',
    description: 'UI tests, stage 6b: record your classification of failures (e.g. after inspecting UNKNOWN ones).',
    inputSchema: obj({
      ...story,
      updates: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            testId: { type: 'string' },
            classification: { type: 'string', enum: ['ENVIRONMENT_FAILURE', 'TIMING_SYNCHRONIZATION', 'LOCATOR_FAILURE', 'TEST_DATA_FAILURE', 'NETWORK_API_FAILURE', 'PRODUCT_DEFECT', 'TEST_DEFECT'] },
            rootCause: { type: 'string' },
          },
          required: ['testId', 'classification', 'rootCause'],
        },
      },
    }, ['story', 'updates']),
  },
  {
    name: 'qa_ui_heal_timing',
    description: 'UI tests, stage 7a: automatically fix timing failures (explicit assertion timeouts, no fixed waits). Lists the failures that need your healing (qa-ui-healing prompt).',
    inputSchema: obj(story, ['story']),
  },
  {
    name: 'qa_ui_write_report',
    description: 'UI tests, stage 9: write the QA report for the story and return it.',
    inputSchema: obj(story, ['story']),
  },
  {
    name: 'qa_ui_get_context',
    description: 'Return the full UI workflow state for a story (requirements, test cases, results, failures, healing).',
    inputSchema: obj(story, ['story']),
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const text = (t: string, isError = false): CallToolResult => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });
const json = (v: unknown) => JSON.stringify(v, null, 2);

function storyIdFor(cfg: ProjectConfig, storyArg: string): string {
  try { return storyIdOf(resolveStory(cfg, storyArg)); } catch { /* not a file: maybe a bare id */ }
  const num = storyArg.match(/^(?:US-?)?(\d+)$/i)?.[1];
  if (num) return `US-${num.padStart(3, '0')}`;
  return storyIdOf(storyArg);
}

function summariseApi(cfg: ProjectConfig, s: OrchestratorState) {
  const run = s.finalRun ?? s.firstRun;
  return {
    storyId: s.storyId,
    stoppedAtReview: s.stoppedAtReview ?? null,
    review: s.review ?? null,
    plannedTestCases: s.testDesign?.testCases.length ?? 0,
    preCoverage: s.preCoverage ? { percent: s.preCoverage.coveragePercent, gaps: s.preCoverage.gaps.length } : null,
    spec: s.generatedTestPath ? relative(cfg.root, s.generatedTestPath) : null,
    result: run ? { passed: run.passed, failed: run.failed, total: run.total, healed: s.healAttempted ? (s.firstRun?.failed ?? 0) - run.failed : 0 } : null,
    failures: run?.failures.map(f => ({ title: f.title, error: f.error.split('\n')[0], diagnosis: s.analysis?.failures.find(a => a.testTitle === f.title) ?? null })) ?? [],
    coverage: s.coverageReport ? { score: s.coverageReport.coverageScore, verdict: s.coverageReport.verdict, remainingGaps: s.coverageReport.remainingGaps.map(g => g.recommendation) } : null,
  };
}

function listPrompts() {
  if (!existsSync(PROMPTS_DIR)) return [];
  return readdirSync(PROMPTS_DIR).filter(f => f.endsWith('.md')).map(f => {
    const src = readFileSync(join(PROMPTS_DIR, f), 'utf-8');
    const front = src.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '';
    const field = (k: string) => front.match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1]?.trim();
    const args = (field('arguments') ?? '').split(',').map(a => a.trim()).filter(Boolean);
    return {
      name: basename(f, '.md'),
      description: field('description') ?? '',
      arguments: args.map(a => ({ name: a, description: 'User story ID or path', required: true })),
      body: src.replace(/^---\n[\s\S]*?\n---\n/, ''),
    };
  });
}

// Tool calls share the log buffer and project files, so run them one at a time.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

// ── Server ────────────────────────────────────────────────────────────────────

export function createServer(): Server {
  const startupCfg = loadConfig();
  const browser = new BrowserBridge(inProject(startupCfg, startupCfg.outputDir));
  const server = new Server(
    { name: 'qa-orchestrator-mcp', version: VERSION },
    {
      capabilities: { tools: {}, prompts: {} },
      instructions:
        'QA orchestration for this project. ' +
        'API tests: qa_api_plan → if coverage gate is awaiting, show gaps and ask for decision → qa_api_coverage_review with their answer → qa_api_plan again → show test plan and ask for decision → qa_api_review with their answer → qa_api_run. ' +
        'Never approve, proceed or reject on the user\'s behalf — both gates require a human decision. ' +
        'UI tests: follow the qa-ui-workflow prompt (qa_ui_* tools plus the browser_* tools).',
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...TOOLS, ...(await browser.listTools())] }));

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: listPrompts().map(({ name, description, arguments: args }) => ({ name, description, arguments: args })),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async req => {
    const p = listPrompts().find(x => x.name === req.params.name);
    if (!p) throw new Error(`Unknown prompt: ${req.params.name}`);
    const body = p.body.replace(/\{\{(\w+)\}\}/g, (_, k) => req.params.arguments?.[k] ?? `<${k}>`);
    return { description: p.description, messages: [{ role: 'user', content: { type: 'text', text: body } }] };
  });

  server.setRequestHandler(CallToolRequestSchema, async req => {
    const { name } = req.params;
    const args = (req.params.arguments ?? {}) as Record<string, any>;

    if (name.startsWith('browser_') || (!TOOLS.some(t => t.name === name) && browser.has(name))) {
      return browser.call(name, args);
    }

    return serial(async () => {
      try {
        const cfg = loadConfig(args.projectRoot);
        const { result, output } = await captureLog(() => handle(server, cfg, name, args, browser));
        return output && result.content[0]?.type === 'text'
          ? { ...result, content: [...result.content, { type: 'text' as const, text: `--- log ---\n${output}` }] }
          : result;
      } catch (err) {
        return text(`Error: ${(err as Error).message}`, true);
      }
    });
  });

  server.onclose = () => { void browser.close(); };
  return server;
}

async function handle(server: Server, cfg: ProjectConfig, name: string, args: Record<string, any>, browser: BrowserBridge): Promise<CallToolResult> {
  switch (name) {
    case 'qa_status': {
      const pw = resolvePlaywright(cfg.root);
      await browser.listTools();
      return text(json({
        version: VERSION,
        config: cfg,
        configFile: existsSync(join(cfg.root, CONFIG_FILE)) ? CONFIG_FILE : `none (defaults; create ${CONFIG_FILE} to override)`,
        playwright: {
          source: pw.source,
          cli: pw.cli,
          browser: browserInstalled(cfg.root).installed ? 'installed' : 'not installed — tests cannot run until qa_install_browsers is run',
        },
        browserTools: browser.enabled ? (browser.error ?? 'available') : 'disabled (QA_BROWSER_DISABLED=1)',
      }));
    }

    case 'qa_install_browsers': {
      const r = installBrowsers(cfg.root, args.browsers?.length ? args.browsers : ['chromium']);
      return text(`${r.exitCode === 0 ? 'Installed.' : `Install failed (exit ${r.exitCode}).`}\n${r.output}`, r.exitCode !== 0);
    }

    case 'qa_list_stories': {
      const dir = inProject(cfg, cfg.storiesDir);
      const files = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.md')).sort() : [];
      return text(files.length ? files.map(f => `${storyIdOf(f)}  ${relative(cfg.root, join(dir, f))}`).join('\n') : `No stories found in ${dir}`);
    }

    case 'qa_api_plan': {
      const storyPath = resolveStory(cfg, args.story);
      const state = await planStory(cfg, storyPath);
      // Coverage gate: stop here if the gap set hasn't been signed off
      if (state.stoppedAtCoverage === 'awaiting') {
        return text(`${coverageGatePacket(state.storyId, state.preCoverage!)}`);
      }
      const outcome = reviewPlannedStory(cfg, state);
      if (outcome.status === 'decided') {
        return text(`${state.storyId}: this exact plan was already reviewed — ${outcome.record.decision} by ${outcome.record.reviewer}. Run qa_api_run to continue.\n\n${json(summariseApi(cfg, state))}`);
      }
      return text(`${outcome.packet}\n---\nAWAITING HUMAN REVIEW. Show this plan to the user and ask for their decision; then call qa_api_review with exactly what they said.`);
    }

    case 'qa_api_coverage_review': {
      const storyPath = resolveStory(cfg, args.story);
      // Re-run phases 1-4 to get the current coverage so the hash matches
      const state = await planStory(cfg, storyPath);
      if (!state.preCoverage) return text(`${state.storyId}: could not compute coverage — check that the story has an Implementation section with endpoints.`, true);
      recordCoverageDecision(reviewDirOf(cfg), state.storyId, state.preCoverage, args.decision, args.reviewer, args.notes ?? '');
      if (args.decision === 'proceed') {
        return text(`Coverage gate approved by ${args.reviewer} for ${state.storyId}. Call qa_api_plan again to see the full test plan.`);
      }
      return text(`Coverage gate: revision requested by ${args.reviewer} for ${state.storyId}.${args.notes ? ` Notes: ${args.notes}` : ''} Address the gaps, update the story, then call qa_api_plan to redesign the test suite.`);
    }

    case 'qa_api_review': {
      const storyId = storyIdFor(cfg, args.story);
      const record = recordDecision(reviewDirOf(cfg), storyId, {
        decision: args.decision, reviewer: args.reviewer, comment: args.comment, excludedTestCaseIds: args.excludedTestCaseIds,
      });
      return text(`Recorded for ${storyId}: ${record.decision} by ${record.reviewer}${record.excludedTestCaseIds.length ? `, excluding ${record.excludedTestCaseIds.join(', ')}` : ''}. ${record.decision === 'approve' ? 'Run qa_api_run to generate and run the tests.' : 'No tests will be generated.'}`);
    }

    case 'qa_api_run': {
      const storyPath = resolveStory(cfg, args.story);
      let state = await runApiOrchestrator(cfg, storyPath, { skipReview: args.skipReview === true });

      // Coverage gate: elicit or ask the user to call qa_api_coverage_review
      if (state.stoppedAtCoverage === 'awaiting') {
        const asked = await askForCoverageReview(server, cfg, state);
        if (asked === 'recorded') state = await runApiOrchestrator(cfg, storyPath, { skipReview: args.skipReview === true });
        else if (asked === 'declined') return text(`${state.storyId}: the reviewer declined to decide on coverage. Nothing was generated.`);
        else {
          return text(`${coverageGatePacket(state.storyId, state.preCoverage!)}\n---\nAWAITING COVERAGE REVIEW. Show the gaps above, ask for the user's decision, record it with qa_api_coverage_review, then call qa_api_run again.`);
        }
      }

      if (state.stoppedAtReview === 'awaiting') {
        const asked = await askForReview(server, cfg, state);
        if (asked === 'recorded') state = await runApiOrchestrator(cfg, storyPath);
        else if (asked === 'declined') return text(`${state.storyId}: the reviewer declined to decide. Nothing was generated.`);
        else {
          return text(`${state.pendingReview!.packet}\n---\nAWAITING HUMAN REVIEW (${state.pendingReview!.reason}). Nothing was generated. Show this plan to the user, ask for their decision, record it with qa_api_review, then call qa_api_run again.`);
        }
      }
      return text(json(summariseApi(cfg, state)));
    }

    case 'qa_ui_analyze_story': {
      const ctx = analyzeStory(cfg, resolveStory(cfg, args.story));
      return text(json({ storyId: ctx.storyId, requirements: ctx.requirements, next: 'Design test cases (qa-ui-test-design prompt) and save them with qa_ui_save_test_cases.' }));
    }
    case 'qa_ui_save_test_cases': {
      const ctx = saveTestCases(cfg, storyIdFor(cfg, args.story), args.testCases as UiTestCase[]);
      return text(json({ storyId: ctx.storyId, saved: ctx.testCases.length, warnings: (ctx as any).warnings ?? [], next: 'qa_ui_scan_framework' }));
    }
    case 'qa_ui_scan_framework':
      return text(json(scanFramework(cfg, storyIdFor(cfg, args.story)).frameworkDiscovery));
    case 'qa_ui_generate_spec': {
      const r = generateSpec(cfg, storyIdFor(cfg, args.story), args.overwrite === true);
      return text(json({ spec: relative(cfg.root, r.specFile), stubs: r.automatedTests.length, next: 'Enrich each TODO: [MCP-ENRICH] stub using the browser tools (qa-ui-enrich-spec prompt), then qa_ui_run_spec.' }));
    }
    case 'qa_ui_run_spec': {
      const r = executeSpec(cfg, storyIdFor(cfg, args.story));
      const counts = { pass: r.executionResults.filter(x => x.result === 'PASS').length, fail: r.executionResults.filter(x => x.result === 'FAIL').length, skip: r.executionResults.filter(x => x.result === 'SKIP').length };
      return text(json({ status: r.status, counts, results: r.executionResults, ...(r.status === 'BLOCKED' ? { playwrightOutput: r.output } : {}) }), r.status === 'BLOCKED');
    }
    case 'qa_ui_classify_failures':
      return text(json(classifyFailures(cfg, storyIdFor(cfg, args.story)).failures));
    case 'qa_ui_update_failures': {
      const ctx = loadContext(cfg, storyIdFor(cfg, args.story));
      for (const u of args.updates as { testId: string; classification: any; rootCause: string }[]) {
        const f = ctx.failures.find(x => x.testId === u.testId);
        if (!f) throw new Error(`No recorded failure for ${u.testId}`);
        f.classification = u.classification;
        f.rootCause = u.rootCause;
        f.action = u.classification === 'PRODUCT_DEFECT' ? 'REPORT_DEFECT'
          : ['ENVIRONMENT_FAILURE', 'NETWORK_API_FAILURE'].includes(u.classification) ? 'INVESTIGATE' : 'HEAL';
      }
      saveContext(cfg, ctx);
      return text(json(ctx.failures));
    }
    case 'qa_ui_heal_timing': {
      const r = healTimingFailures(cfg, storyIdFor(cfg, args.story));
      return text(json({ healingAttempts: r.healingAttempts, needsAgent: r.needsAgent }));
    }
    case 'qa_ui_write_report': {
      const r = writeReport(cfg, storyIdFor(cfg, args.story));
      return text(`${r.report}\n---\nReport written to ${relative(cfg.root, r.reportFile)}`);
    }
    case 'qa_ui_get_context':
      return text(json(loadContext(cfg, storyIdFor(cfg, args.story))));
    default:
      return text(`Unknown tool: ${name}`, true);
  }
}

/** Ask the user to approve or revise coverage gaps via MCP elicitation, when supported. */
async function askForCoverageReview(server: Server, cfg: ProjectConfig, state: OrchestratorState): Promise<'recorded' | 'declined' | 'unsupported'> {
  if (!server.getClientCapabilities()?.elicitation) return 'unsupported';
  const s = state.preCoverage!;
  const gaps = s.gaps.map(g => `• [${g.gapType}] ${g.recommendation}`).join('\n') || 'none';
  const result = await server.elicitInput({
    mode: 'form',
    message: `Review coverage gaps for ${state.storyId} before the test plan is shown.\n\nCoverage: ${s.coveragePercent}% · ${s.gaps.length} gap(s)\n${gaps}`,
    requestedSchema: {
      type: 'object',
      properties: {
        decision: { type: 'string', title: 'Decision', enum: ['proceed', 'revise'] },
        reviewer: { type: 'string', title: 'Your name' },
        notes: { type: 'string', title: 'Notes', description: 'Optional: gaps to address when revising' },
      },
      required: ['decision', 'reviewer'],
    },
  } as any);
  if (result.action !== 'accept' || !result.content) return 'declined';
  const c = result.content as Record<string, string>;
  recordCoverageDecision(reviewDirOf(cfg), state.storyId, state.preCoverage!, c.decision as 'proceed' | 'revise', c.reviewer, c.notes ?? '');
  return 'recorded';
}

/** Ask the user for the review decision through the client (MCP elicitation), when supported. */
async function askForReview(server: Server, cfg: ProjectConfig, state: OrchestratorState): Promise<'recorded' | 'declined' | 'unsupported'> {
  if (!server.getClientCapabilities()?.elicitation) return 'unsupported';
  const s = state.preCoverage!;
  const cases = state.testDesign!.testCases.map(tc => `${tc.id}  ${tc.method} ${tc.endpoint} → ${tc.expectedStatus}  ${tc.name}`).join('\n');
  const gaps = s.gaps.map(g => `• ${g.recommendation}`).join('\n') || 'none';
  const result = await server.elicitInput({
    mode: 'form',
    message: `Review the API test plan for ${state.storyId} before anything is generated.\n\nCoverage: ${s.coveragePercent}% · ${s.gaps.length} gap(s)\n${gaps}\n\nPlanned test cases:\n${cases}`,
    requestedSchema: {
      type: 'object',
      properties: {
        decision: { type: 'string', title: 'Decision', enum: ['approve', 'reject'] },
        excludedTestCaseIds: { type: 'string', title: 'Exclude test cases', description: 'Comma-separated IDs to drop (approve only)' },
        reviewer: { type: 'string', title: 'Your name' },
        comment: { type: 'string', title: 'Comment', description: 'Required when rejecting' },
      },
      required: ['decision', 'reviewer'],
    },
  } as any);
  if (result.action !== 'accept' || !result.content) return 'declined';
  const c = result.content as Record<string, string>;
  recordDecision(reviewDirOf(cfg), state.storyId, {
    decision: c.decision as 'approve' | 'reject',
    reviewer: c.reviewer,
    comment: c.comment,
    excludedTestCaseIds: (c.excludedTestCaseIds ?? '').split(',').map(x => x.trim()).filter(Boolean),
  }, 'elicit');
  return 'recorded';
}
