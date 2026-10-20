import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { CONFIG_FILE } from './core/config';

// `qa-orchestrator-mcp init` — register this server with the project's MCP clients
// (no `claude mcp add` needed) and create a starter config.

const PKG = 'qa-orchestrator-mcp';
const SERVER_NAME = 'qa';

interface InitOptions {
  root: string;
  claude: boolean;
  vscode: boolean;
  force: boolean;
  apiBaseUrl?: string;
  uiBaseUrl?: string;
}

function parseArgs(argv: string[]): InitOptions | 'help' {
  const opts: InitOptions = { root: process.cwd(), claude: true, vscode: true, force: false };
  let only: ('claude' | 'vscode')[] | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => argv[++i] ?? '';
    if (a === '-h' || a === '--help') return 'help';
    else if (a === '--claude') (only ??= []).push('claude');
    else if (a === '--vscode') (only ??= []).push('vscode');
    else if (a === '--force') opts.force = true;
    else if (a === '--root') opts.root = resolve(value());
    else if (a.startsWith('--root=')) opts.root = resolve(a.slice(7));
    else if (a === '--api-url') opts.apiBaseUrl = value();
    else if (a.startsWith('--api-url=')) opts.apiBaseUrl = a.slice(10);
    else if (a === '--ui-url') opts.uiBaseUrl = value();
    else if (a.startsWith('--ui-url=')) opts.uiBaseUrl = a.slice(9);
    else throw new Error(`Unknown option: ${a}`);
  }
  if (only) { opts.claude = only.includes('claude'); opts.vscode = only.includes('vscode'); }
  return opts;
}

const HELP = `Usage: npx ${PKG} init [options]

Registers the QA orchestrator MCP server for this project and creates a config file.

  --claude          only write .mcp.json (Claude Code)
  --vscode          only write .vscode/mcp.json (VS Code)
                    (default: both)
  --api-url <url>   API base URL for the config (default http://localhost:3000)
  --ui-url <url>    UI base URL for the config (default http://localhost:3000)
  --root <dir>      project root (default: current directory)
  --force           replace an existing "${SERVER_NAME}" server entry and config file

Install it in the project first so everyone gets the same version:
  npm install --save-dev ${PKG}
`;

function readJson(file: string): any {
  if (!existsSync(file)) return {};
  const raw = readFileSync(file, 'utf-8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${file} is not valid JSON (${(err as Error).message}); fix or remove it, then run init again.`);
  }
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf-8');
}

/**
 * How the project should launch the server, as a path relative to the project root:
 * - the package lives inside the project (e.g. packages/qa-orchestrator-mcp in a monorepo),
 * - it is installed in the project's node_modules (a published or local-path dependency), or
 * - neither (init was run through npx) → null, and the config falls back to npx.
 */
function localEntry(root: string): string | null {
  const packageDir = resolve(__dirname, '..');
  const rel = relative(root, packageDir).replace(/\\/g, '/');
  const inside = rel && !rel.startsWith('..') && !/^[A-Za-z]:/.test(rel);
  if (inside && !rel.split('/').includes('node_modules')) return `${rel}/dist/index.js`;
  if (existsSync(join(root, 'node_modules', PKG, 'package.json'))) return `node_modules/${PKG}/dist/index.js`;
  return null;
}

export function runInit(argv: string[]): number {
  let opts: InitOptions | 'help';
  try {
    opts = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n\n${HELP}`);
    return 2;
  }
  if (opts === 'help') { process.stdout.write(HELP); return 0; }

  const { root } = opts;
  if (!existsSync(join(root, 'package.json'))) {
    process.stderr.write(`No package.json in ${root}. Run init from your project root (or pass --root).\n`);
    return 2;
  }

  const entry = localEntry(root);
  const local = entry !== null;
  const done: string[] = [];
  const skipped: string[] = [];

  // Launching `node <installed entry>` works the same on every OS (npx needs a `cmd /c`
  // wrapper on Windows) and pins the version to the one in package.json.
  if (opts.claude) {
    const file = join(root, '.mcp.json');
    const cfg = readJson(file);
    cfg.mcpServers ??= {};
    if (cfg.mcpServers[SERVER_NAME] && !opts.force) skipped.push(`.mcp.json already has a "${SERVER_NAME}" server (use --force to replace)`);
    else {
      cfg.mcpServers[SERVER_NAME] = local
        ? { type: 'stdio', command: 'node', args: [entry!], env: {} }
        : process.platform === 'win32'
          ? { type: 'stdio', command: 'cmd', args: ['/c', 'npx', '-y', PKG], env: {} }
          : { type: 'stdio', command: 'npx', args: ['-y', PKG], env: {} };
      writeJson(file, cfg);
      done.push('.mcp.json — Claude Code (approve the server when Claude Code asks)');
    }
  }

  if (opts.vscode) {
    const file = join(root, '.vscode', 'mcp.json');
    const cfg = readJson(file);
    cfg.servers ??= {};
    if (cfg.servers[SERVER_NAME] && !opts.force) skipped.push(`.vscode/mcp.json already has a "${SERVER_NAME}" server (use --force to replace)`);
    else {
      cfg.servers[SERVER_NAME] = local
        ? { type: 'stdio', command: 'node', args: [`\${workspaceFolder}/${entry}`], cwd: '${workspaceFolder}' }
        : { type: 'stdio', command: 'npx', args: ['-y', PKG], cwd: '${workspaceFolder}' };
      writeJson(file, cfg);
      done.push('.vscode/mcp.json — VS Code (start it from "MCP: List Servers")');
    }
  }

  const configFile = join(root, CONFIG_FILE);
  if (existsSync(configFile) && !opts.force) skipped.push(`${CONFIG_FILE} already exists`);
  else {
    writeJson(configFile, {
      storiesDir: 'user-stories',
      outputDir: '.qa-orchestrator',
      api: { baseUrl: opts.apiBaseUrl ?? 'http://localhost:3000', testsDir: 'tests/api', examples: {} },
      ui: {
        baseUrl: opts.uiBaseUrl ?? 'http://localhost:3000',
        specsDir: 'tests/specs', pagesDir: 'tests/pages', fixturesFile: 'tests/fixtures/test.fixture.ts', dataDir: 'tests/data',
      },
    });
    done.push(`${CONFIG_FILE} — project settings (edit URLs and folders as needed)`);
  }

  const gitignore = join(root, '.gitignore');
  const current = existsSync(gitignore) ? readFileSync(gitignore, 'utf-8') : '';
  if (!/^\/?\.qa-orchestrator\/?\s*$/m.test(current)) {
    writeFileSync(gitignore, `${current}${current && !current.endsWith('\n') ? '\n' : ''}\n# QA orchestrator state, review packets and reports\n.qa-orchestrator/\n`, 'utf-8');
    done.push('.gitignore — ignores .qa-orchestrator/');
  }

  const rel = (p: string) => relative(process.cwd(), p) || '.';
  process.stdout.write(`\nqa-orchestrator-mcp set up in ${rel(root)}\n\n`);
  for (const d of done) process.stdout.write(`  ✓ ${d}\n`);
  for (const s of skipped) process.stdout.write(`  – skipped: ${s}\n`);
  if (!local) {
    process.stdout.write(`\n  Note: ${PKG} isn't installed in this project, so the config runs it with npx (needs it on the npm registry).\n`);
    process.stdout.write(`  Without publishing: npm install --save-dev <path-to-clone>/packages/${PKG}, then run init --force.\n`);
  }
  process.stdout.write(`\nNext: restart your editor's MCP connection, then ask the agent to run qa_status.\n`);
  return 0;
}
