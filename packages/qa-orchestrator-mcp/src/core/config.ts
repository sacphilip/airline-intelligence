import { existsSync, readdirSync, readFileSync } from 'fs';
import { isAbsolute, join, resolve } from 'path';

/**
 * Per-project settings. Everything has a default, so a project needs no config
 * at all; override in `qa-orchestrator.config.json` at the project root, or with
 * the environment variables noted below (handy in an MCP client's `env` block).
 */
export interface ProjectConfig {
  /** Absolute project root. Env: QA_PROJECT_ROOT (default: the server's working directory). */
  root: string;
  /** Where user stories live. Default: user-stories */
  storiesDir: string;
  /** Orchestrator state, review packets and reports. Default: .qa-orchestrator */
  outputDir: string;
  api: {
    /** Env: API_BASE_URL. Default: http://localhost:3000 */
    baseUrl: string;
    /** Env: OPENAPI_URL. Default: <baseUrl>/api-docs-json */
    openApiUrl: string;
    /** Generated API specs. Default: tests/api */
    testsDir: string;
    /** Example query-parameter values for generated requests, e.g. { "number": "6E5321" }. */
    examples: Record<string, string>;
  };
  ui: {
    /** Env: UI_BASE_URL. Default: http://localhost:3000 */
    baseUrl: string;
    specsDir: string;
    pagesDir: string;
    fixturesFile: string;
    dataDir: string;
  };
}

export const CONFIG_FILE = 'qa-orchestrator.config.json';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export function loadConfig(rootOverride?: string): ProjectConfig {
  const root = resolve(rootOverride ?? process.env.QA_PROJECT_ROOT ?? process.cwd());
  const file = join(root, CONFIG_FILE);
  let fromFile: DeepPartial<ProjectConfig> = {};
  if (existsSync(file)) {
    try {
      fromFile = JSON.parse(readFileSync(file, 'utf-8'));
    } catch (err) {
      throw new Error(`${file} is not valid JSON: ${(err as Error).message}`);
    }
  }

  const apiBase = process.env.API_BASE_URL ?? fromFile.api?.baseUrl ?? 'http://localhost:3000';
  return {
    root,
    storiesDir: fromFile.storiesDir ?? 'user-stories',
    outputDir: fromFile.outputDir ?? '.qa-orchestrator',
    api: {
      baseUrl: apiBase,
      openApiUrl: process.env.OPENAPI_URL ?? fromFile.api?.openApiUrl ?? `${apiBase.replace(/\/$/, '')}/api-docs-json`,
      testsDir: fromFile.api?.testsDir ?? 'tests/api',
      examples: (fromFile.api?.examples ?? {}) as Record<string, string>,
    },
    ui: {
      baseUrl: process.env.UI_BASE_URL ?? fromFile.ui?.baseUrl ?? 'http://localhost:3000',
      specsDir: fromFile.ui?.specsDir ?? 'tests/specs',
      pagesDir: fromFile.ui?.pagesDir ?? 'tests/pages',
      fixturesFile: fromFile.ui?.fixturesFile ?? 'tests/fixtures/test.fixture.ts',
      dataDir: fromFile.ui?.dataDir ?? 'tests/data',
    },
  };
}

/** Resolve a project-relative path (absolute paths pass through). */
export function inProject(cfg: ProjectConfig, ...parts: string[]): string {
  const p = join(...parts);
  return isAbsolute(p) ? p : join(cfg.root, p);
}

/** Resolve a story argument: a path, a file name, or an ID like "US-001" / "1". */
export function resolveStory(cfg: ProjectConfig, story: string): string {
  const direct = inProject(cfg, story);
  if (existsSync(direct)) return direct;
  const inStories = inProject(cfg, cfg.storiesDir, story);
  if (existsSync(inStories)) return inStories;

  const num = story.match(/^(?:US-?)?(\d+)$/i)?.[1];
  if (num) {
    const id = `US-${num.padStart(3, '0')}`;
    const dir = inProject(cfg, cfg.storiesDir);
    if (existsSync(dir)) {
      const hit = readdirSync(dir).find(f => f.toUpperCase().startsWith(id) && f.endsWith('.md'));
      if (hit) return join(dir, hit);
    }
  }
  throw new Error(`User story "${story}" not found (looked in ${inProject(cfg, cfg.storiesDir)}).`);
}

export function storyIdOf(storyPath: string): string {
  const name = storyPath.replace(/\\/g, '/').split('/').pop()!.replace(/\.md$/i, '');
  return name.match(/US-\d+/i)?.[0].toUpperCase() ?? name.toUpperCase();
}
