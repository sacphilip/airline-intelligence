#!/usr/bin/env node
/**
 * Locator healer for Playwright runs in CI.
 *
 * When a test fails only because a locator drifted (a button renamed, a placeholder
 * reworded), this finds the element the locator meant in Playwright's page snapshot,
 * patches the locator, and re-runs the failed tests to prove the fix.
 *
 *   1. Deterministic: same role, closest accessible name. Heals only when there is
 *      exactly one strong match. No network, no cost.
 *   2. Claude (optional, --claude and ANTHROPIC_API_KEY): for locator failures step 1
 *      can't place (wording changed completely, several similar elements). Its edits are
 *      validated to change locators only, never assertions or test logic.
 *
 * Healing never changes what a test asserts. A failure where the element was found but
 * the assertion failed (wrong text, wrong count) is a real failure and is left alone.
 *
 * Usage:
 *   node scripts/ci/heal-locators.cjs --report <playwright-json> --config <playwright-config>
 *        [--claude] [--out heal-report] [--tests-dir tests]
 *
 * Claude Code route (claude-code-action with a Pro/Max token instead of an API key):
 *   1. ... --claude-request heal-report/claude-request.md   (writes the request + state, outputs result=needs_claude)
 *   2. anthropics/claude-code-action answers it (structured output, schema from the `schema` step output)
 *   3. node scripts/ci/heal-locators.cjs --resume [--answer-env CLAUDE_ANSWER]   (applies the answer, re-runs)
 *
 * Writes <out>/summary.json, <out>/healed.patch and <out>/comment.md.
 * Exit 0: every failure was healed and passes on re-run (the job may pass).
 * Exit 1: failures remain. Exit 2: the healer itself could not run.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// ── Arguments ─────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { report: null, config: null, claude: false, out: 'heal-report', testsDir: 'tests', root: process.cwd(),
    claudeRequest: null, resume: false, answerEnv: 'CLAUDE_ANSWER', answerFile: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--report') opts.report = next();
    else if (a === '--config') opts.config = next();
    else if (a === '--claude') opts.claude = true;
    else if (a === '--claude-request') opts.claudeRequest = next();
    else if (a === '--resume') opts.resume = true;
    else if (a === '--answer-env') opts.answerEnv = next();
    else if (a === '--answer-file') opts.answerFile = next();
    else if (a === '--out') opts.out = next();
    else if (a === '--tests-dir') opts.testsDir = next();
    else if (a === '--root') opts.root = path.resolve(next());
    else throw new Error(`Unknown option ${a}`);
  }
  if (!opts.report && !opts.resume) throw new Error('--report <playwright json report> is required');
  return opts;
}

const stripAnsi = (s) => String(s ?? '').replace(/\x1b\[[0-9;]*m/g, '');
const posix = (p) => p.replace(/\\/g, '/');

// ── Reading the Playwright report ─────────────────────────────────────────────

/** Every failed test with its error text, failure location and page snapshot. */
function failedTests(report, root) {
  const out = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const result = test.results?.[test.results.length - 1];
        if (!result || result.status === 'passed' || result.status === 'skipped') continue;
        if (test.status === 'flaky') continue;
        const errors = (result.errors?.length ? result.errors : [result.error]).filter(Boolean);
        const messages = errors.map((e) => stripAnsi(e.message));
        const located = errors.find((e) => e.location) ?? null;
        const ctx = (result.attachments ?? []).find((a) => a.name === 'error-context' && a.path);
        out.push({
          title: spec.title,
          file: posix(path.relative(root, located?.location?.file ?? path.join(root, spec.file ?? ''))),
          line: located?.location?.line ?? null,
          message: messages.join('\n'),
          snapshot: ctx && fs.existsSync(ctx.path) ? extractSnapshot(fs.readFileSync(ctx.path, 'utf-8')) : null,
          contextFile: ctx?.path ?? null,
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const s of report.suites ?? []) walk(s);
  return out;
}

/** The ARIA snapshot YAML from Playwright's error-context.md. */
function extractSnapshot(md) {
  const section = md.split(/^# Page snapshot\s*$/m)[1] ?? md;
  return section.match(/```yaml\n([\s\S]*?)```/)?.[1] ?? null;
}

/** The locator a failure was waiting for, as Playwright printed it. */
function failingLocator(message) {
  if (/strict mode violation/i.test(message)) return { kind: 'strict', raw: message.match(/strict mode violation: (.+?) resolved/)?.[1] ?? null };

  // expect(locator) assertion: "Locator: …" plus either "element(s) not found" (drift
  // candidate) or a received value (the element exists — the assertion failed for real).
  const asserted = message.match(/^Locator: (.+)$/m)?.[1];
  if (asserted) {
    return /element\(s\) not found/i.test(message)
      ? { kind: 'not-found', raw: asserted.trim() }
      : { kind: 'found', raw: asserted.trim() };
  }

  // Action (click/fill/…) that timed out waiting for its locator: the element never appeared.
  const action = message.match(/locator\.\w+: (?:Test )?[Tt]imeout[^\n]*\n[\s\S]*?waiting for (getBy\w+\(.*\)|locator\(.*\))\s*$/m)?.[1];
  if (action) return { kind: 'not-found', raw: action.trim() };
  return null;
}

// ── Parsing locators and snapshots ────────────────────────────────────────────

const STR = String.raw`'((?:[^'\\]|\\.)*)'`;

/** Understands the locators Playwright prints: getByRole/Text/Placeholder/Label with string names. */
function parseLocator(raw) {
  let m = raw.match(new RegExp(String.raw`^getByRole\('([\w-]+)'(?:,\s*\{\s*name:\s*${STR}(?:,\s*exact:\s*(true|false))?\s*\})?\)$`));
  if (m) return { method: 'getByRole', role: m[1], value: m[2] ?? null, exact: m[3] === 'true' };
  m = raw.match(new RegExp(String.raw`^(getByText|getByPlaceholder|getByLabel)\(${STR}(?:,\s*\{\s*exact:\s*(true|false)\s*\})?\)$`));
  if (m) return { method: m[1], value: m[2], exact: m[3] === 'true' };
  return null; // regex names, test ids, chained or CSS locators: not handled deterministically
}

/** Nodes of an ARIA snapshot: `- button "Find flights" [ref=e3]`, `- text: Hello`, `- paragraph: Hi`. */
function parseSnapshot(yaml) {
  const nodes = [];
  for (const line of String(yaml ?? '').split('\n')) {
    const m = line.match(/^\s*-\s+([a-z]+)(?:\s+"((?:[^"\\]|\\.)*)")?(?:\s*\[[^\]]*\])*\s*(?::\s*(.*))?$/);
    if (!m) continue;
    const name = (m[2] ?? '').replace(/\\"/g, '"');
    const text = (m[3] ?? '').replace(/^"(.*)"$/, '$1').trim();
    nodes.push({ role: m[1], name, text });
  }
  return nodes;
}

const TEXT_INPUT_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton']);

function candidatesFor(loc, nodes) {
  switch (loc.method) {
    case 'getByRole': return nodes.filter((n) => n.role === loc.role && n.name).map((n) => n.name);
    case 'getByPlaceholder': return nodes.filter((n) => TEXT_INPUT_ROLES.has(n.role) && n.name).map((n) => n.name);
    case 'getByLabel': return nodes.filter((n) => n.name && n.role !== 'text').map((n) => n.name);
    case 'getByText': return nodes.flatMap((n) => [n.name, n.text]).filter(Boolean);
    default: return [];
  }
}

// ── Similarity ────────────────────────────────────────────────────────────────

const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function bigrams(s) {
  const t = norm(s).replace(/ /g, '');
  const out = new Map();
  for (let i = 0; i < t.length - 1; i++) out.set(t.slice(i, i + 2), (out.get(t.slice(i, i + 2)) ?? 0) + 1);
  return out;
}

function dice(a, b) {
  const A = bigrams(a); const B = bigrams(b);
  let overlap = 0; let total = 0;
  for (const [k, v] of A) { overlap += Math.min(v, B.get(k) ?? 0); total += v; }
  for (const v of B.values()) total += v;
  return total ? (2 * overlap) / total : 0;
}

function tokenOverlap(a, b) {
  const A = new Set(norm(a).split(' ').filter(Boolean)); const B = new Set(norm(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let n = 0; for (const t of A) if (B.has(t)) n++;
  return n / Math.max(A.size, B.size);
}

const similarity = (a, b) => Math.max(dice(a, b), tokenOverlap(a, b));

/** Playwright's default (non-exact) name matching: case-insensitive substring. */
const matchesNow = (loc, name) => (loc.exact ? name === loc.value : name.toLowerCase().includes(loc.value.toLowerCase()));

const MIN_SCORE = 0.5;
const MIN_MARGIN = 0.15;

function deterministicFix(loc, snapshot) {
  if (!loc || loc.value == null) return { reason: 'locator has no plain-text name to compare' };
  const names = [...new Set(candidatesFor(loc, parseSnapshot(snapshot)))];
  if (!names.length) return { reason: `no ${loc.role ?? loc.method} elements on the page at failure time` };
  if (names.some((n) => matchesNow(loc, n))) return { reason: 'a matching element is on the page — not a renamed element (timing or visibility?)' };
  const ranked = names.map((n) => ({ name: n, score: similarity(loc.value, n) })).sort((a, b) => b.score - a.score);
  const [best, second] = ranked;
  if (best.score < MIN_SCORE) return { reason: `closest element "${best.name}" is not similar enough (${best.score.toFixed(2)})`, ranked };
  if (second && best.score - second.score < MIN_MARGIN) return { reason: `"${best.name}" and "${second.name}" are equally close`, ranked };
  return { newValue: best.name, score: best.score };
}

// ── Patching source ───────────────────────────────────────────────────────────

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const unescapeJs = (s) => s.replace(/\\(.)/g, '$1');

/** Source-literal forms of a value, in either quote style. */
function literalPatterns(value) {
  const v = unescapeJs(value);
  return [`'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`, `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`, `\`${v}\``];
}

function quoteLike(original, value) {
  const q = original[0];
  const body = value.replace(/\\/g, '\\\\').replace(new RegExp(escapeRe(q), 'g'), `\\${q}`);
  return `${q}${body}${q}`;
}

/** Test sources, including the tests/locators/*.json files where locators are defined. */
function listSourceFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : listSourceFiles(p);
    return /\.(ts|js|mjs|cjs|json)$/.test(e.name) ? [p] : [];
  });
}

/**
 * Find where the drifted value lives: first the locator call itself in the failing file,
 * then (for the locator JSON files and page objects) the bare string literal — but only if
 * it occurs exactly once across those folders, so the edit can't land somewhere unrelated.
 */
function locateSource(loc, failure, opts) {
  const callStart = { getByRole: String.raw`getByRole\(\s*['"\`]${escapeRe(loc.role ?? '')}['"\`]\s*,\s*\{[^}]*?name:\s*`, getByText: String.raw`getByText\(\s*`, getByPlaceholder: String.raw`getByPlaceholder\(\s*`, getByLabel: String.raw`getByLabel\(\s*` }[loc.method];
  const file = path.join(opts.root, failure.file);
  if (callStart && fs.existsSync(file)) {
    const src = fs.readFileSync(file, 'utf-8');
    for (const lit of literalPatterns(loc.value)) {
      const re = new RegExp(`(${callStart})(${escapeRe(lit)})`, 'g');
      const hits = [...src.matchAll(re)];
      if (hits.length) return { file, literal: lit, mode: 'call', count: hits.length, re };
    }
  }
  const shared = ['locators', 'pages', 'support', 'fixtures'].flatMap((d) => listSourceFiles(path.join(opts.root, opts.testsDir, d)));
  const found = [];
  for (const f of shared) {
    const src = fs.readFileSync(f, 'utf-8');
    for (const lit of literalPatterns(loc.value)) {
      const n = src.split(lit).length - 1;
      if (n) found.push({ file: f, literal: lit, count: n });
    }
  }
  const total = found.reduce((s, x) => s + x.count, 0);
  if (total === 1) return { ...found[0], mode: 'literal' };
  return { reason: total ? `"${unescapeJs(loc.value)}" appears ${total} times in shared test files — ambiguous` : 'could not find where this locator is defined (built from a variable?)' };
}

function applyPatch(where, newValue, backups) {
  const src = fs.readFileSync(where.file, 'utf-8');
  backups.has(where.file) || backups.set(where.file, src);
  const replacement = quoteLike(where.literal, newValue);
  const next = where.mode === 'call'
    ? src.replace(where.re, (_, start) => `${start}${replacement}`)
    : src.replace(where.literal, replacement);
  fs.writeFileSync(where.file, next, 'utf-8');
  const lineOf = (text, needle) => text.slice(0, text.indexOf(needle)).split('\n').length;
  return { line: lineOf(next, replacement), replacement };
}

// ── Claude fallback ───────────────────────────────────────────────────────────

/**
 * Reduce every locator to one placeholder so we can check an edit changed nothing but
 * locators. A chain (`getByRole('region', …).getByRole('button', …)`) counts as one locator,
 * so scoping a locator to its container is allowed.
 */
function withoutLocators(line) {
  let s = line;
  for (let i = 0; i < 5; i++) {
    const next = s.replace(/\b(getBy\w+|locator|filter|nth|first|last)\((?:[^()]|\([^()]*\))*\)/g, 'L()');
    if (next === s) break;
    s = next;
  }
  return s.replace(/L\(\)(?:\s*\.\s*L\(\))+/g, 'L()').replace(/\s+/g, '');
}

/** `.first()` / `.last()` / `.nth()` silence an ambiguous locator instead of fixing it. */
const PICKS_ONE = /\.(?:first|last)\(\s*\)|\.nth\(/g;
const pickCount = (s) => (s.match(PICKS_ONE) ?? []).length;

function validClaudeEdit(edit, opts) {
  const abs = path.resolve(opts.root, edit.file);
  const testsRoot = path.resolve(opts.root, opts.testsDir) + path.sep;
  if (!abs.startsWith(testsRoot)) return `edit outside ${opts.testsDir}/: ${edit.file}`;
  if (!fs.existsSync(abs)) return `no such file: ${edit.file}`;
  if (/\n/.test(edit.find) || /\n/.test(edit.replace)) return 'edits must be single-line';
  const src = fs.readFileSync(abs, 'utf-8');
  const n = src.split(edit.find).length - 1;
  if (n !== 1) return `the text to replace occurs ${n} times in ${edit.file}, expected exactly once`;
  if (abs.endsWith('.json')) return validJsonLocatorEdit(edit, src);
  const isLocatorMap = /[\\/](locators|pages)[\\/]/.test(abs);
  if (pickCount(edit.replace) > pickCount(edit.find)) {
    return 'edit adds .first()/.last()/.nth(), which hides an ambiguous locator instead of fixing it';
  }
  if (!isLocatorMap && withoutLocators(edit.find) !== withoutLocators(edit.replace)) {
    return 'edit changes more than a locator (assertions and test logic must not change)';
  }
  if (isLocatorMap && edit.find.replace(/(['"`]).*?\1/g, '""') !== edit.replace.replace(/(['"`]).*?\1/g, '""')) {
    return 'in locator/page files only string values may change';
  }
  return null;
}

// In tests/locators/*.json an edit may change values, and add or drop "exact" / "within"
// to make an ambiguous locator specific. Any other key change is not a locator fix, and
// "first" / "last" / "nth" would hide the ambiguity like .first() does in code.
const SCOPING_KEYS = new Set(['exact', 'within']);
const jsonKeys = (line) => [...line.matchAll(/"((?:[^"\\]|\\.)*)"\s*:/g)].map((m) => m[1]).filter((k) => !SCOPING_KEYS.has(k)).sort().join(',');

function validJsonLocatorEdit(edit, src) {
  if (jsonKeys(edit.find) !== jsonKeys(edit.replace)) {
    return 'in locator JSON files only values may change (plus "exact" or "within" to make a locator specific)';
  }
  try {
    JSON.parse(src.replace(edit.find, edit.replace));
  } catch (err) {
    return `the edit leaves ${edit.file} invalid JSON (${err.message})`;
  }
  return null;
}

// The answer Claude returns for failures the deterministic pass couldn't place. Shared by
// both routes: the SDK (API key) and Claude Code in CI (claude-code-action + Pro/Max token).
const LOCATOR_FIX_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['test', 'verdict', 'reason', 'edits'],
        properties: {
          test: { type: 'string', description: 'Test title, exactly as given' },
          verdict: { type: 'string', enum: ['locator_drift', 'not_drift'] },
          reason: { type: 'string', description: 'One sentence: what changed on the page, or why this is a real failure' },
          edits: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['file', 'find', 'replace'],
              properties: {
                file: { type: 'string', description: 'Repo-relative path of the file to edit' },
                find: { type: 'string', description: 'One complete line, copied exactly from the file' },
                replace: { type: 'string', description: 'The same line with only the locator changed' },
              },
            },
          },
        },
      },
    },
  },
};

const CLAUDE_INSTRUCTIONS =
  'You repair Playwright locators that drifted because the UI changed (an element was renamed, reworded or moved). ' +
  'Use the page snapshot to find the element each failing locator was meant to target. ' +
  'Only change locators: never change assertions, expected values, test steps or logic. ' +
  'If the page no longer has the element at all, or the failure is not about finding an element, the verdict is not_drift with no edits. ' +
  'A locator that matched several elements needs a more specific locator for the one element the test means (e.g. scope it to its container, or add exact: true) — never .first()/.nth() just to silence the error. ' +
  'Locators are defined only in tests/locators/*.locators.json (built by tests/support/locators.ts); page objects and specs refer to them by key. ' +
  'Fix a drifted locator by editing its entry in that JSON file, never by writing a selector into a spec or page object. ' +
  'Each edit replaces one complete line copied exactly from the file. Prefer role, then label, placeholder, text.';

/** Everything Claude needs about each failure, as markdown. */
function buildCases(failures, opts) {
  const shared = ['locators', 'pages'].flatMap((d) => listSourceFiles(path.join(opts.root, opts.testsDir, d)))
    .map((p) => `--- ${posix(path.relative(opts.root, p))}\n${fs.readFileSync(p, 'utf-8')}`).join('\n');
  const cases = failures.map((f) => {
    const abs = path.join(opts.root, f.file);
    const src = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf-8').split('\n') : [];
    const from = Math.max(0, (f.line ?? 1) - 25);
    const excerpt = src.slice(from, (f.line ?? 1) + 10).map((l, i) => `${String(from + i + 1).padStart(4)} | ${l}`).join('\n');
    return `## Test: ${f.title}\nFile: ${f.file}:${f.line ?? '?'}\n\n### Error\n${f.message.slice(0, 3000)}\n\n### Page snapshot at failure (ARIA)\n${(f.snapshot ?? '(none)').slice(0, 12000)}\n\n### Source around the failure\n${excerpt}`;
  });
  return `${cases.join('\n\n')}\n\n## Locator JSON files and page objects\n${shared.slice(0, 20000)}`;
}

/** Route 1: the Messages API through the SDK (needs ANTHROPIC_API_KEY with API credit). */
async function claudeFixes(failures, opts) {
  let Anthropic;
  try {
    Anthropic = require('@anthropic-ai/sdk');
  } catch {
    return { error: 'the @anthropic-ai/sdk package is not installed' };
  }
  const client = new (Anthropic.default ?? Anthropic)();
  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium' },
    tools: [{ name: 'propose_locator_fixes', description: 'Report locator fixes for the failing tests, or why a failure is not locator drift.', strict: true, input_schema: LOCATOR_FIX_SCHEMA }],
    tool_choice: { type: 'auto' },
    system: `${CLAUDE_INSTRUCTIONS} Report your answer by calling the propose_locator_fixes tool once.`,
    messages: [{ role: 'user', content: buildCases(failures, opts) }],
  });
  if (response.stop_reason === 'refusal') return { error: 'Claude declined the request' };
  const call = response.content.find((b) => b.type === 'tool_use' && b.name === 'propose_locator_fixes');
  if (!call) return { error: 'Claude did not return fixes' };
  return { results: call.input.results ?? [] };
}

/**
 * Route 2: Claude Code in CI. Write a request for anthropics/claude-code-action to answer
 * (it reads this file and returns structured output matching LOCATOR_FIX_SCHEMA); the healer
 * then resumes from the saved state with that answer.
 */
function writeClaudeRequest(file, failures, opts) {
  const body = [
    '# Locator repair request',
    '',
    CLAUDE_INSTRUCTIONS,
    '',
    'Read this file only; do not edit files or run commands. Answer with the structured output',
    '(one entry in `results` per test below, using each test title exactly as written).',
    '',
    buildCases(failures, opts),
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, 'utf-8');
}

/** Apply Claude's answer (from either route) to the pending failures, validating every edit. */
function applyClaudeResults(res, pending, summary, backups, opts) {
  for (const p of pending) {
    const r = res.results?.find((x) => x.test === p.f.title);
    if (!r) { summary.unhealed.push({ ...p.base, reason: `${p.reason}; Claude: ${res.error ?? 'no answer for this test'}` }); continue; }
    if (r.verdict !== 'locator_drift' || !r.edits?.length) { summary.unhealed.push({ ...p.base, reason: `Claude: ${r.reason}` }); continue; }
    const problems = r.edits.map((e) => validClaudeEdit(e, opts)).filter(Boolean);
    if (problems.length) { summary.unhealed.push({ ...p.base, reason: `Claude's edit rejected: ${problems[0]}` }); continue; }
    for (const e of r.edits) {
      const abs = path.resolve(opts.root, e.file);
      const src = fs.readFileSync(abs, 'utf-8');
      backups.has(abs) || backups.set(abs, src);
      fs.writeFileSync(abs, src.replace(e.find, e.replace), 'utf-8');
      summary.healed.push({
        ...p.base, engine: 'claude', reasonText: r.reason, editedFile: posix(e.file),
        editedLine: src.slice(0, src.indexOf(e.find)).split('\n').length, from: e.find.trim(), to: e.replace.trim(),
      });
    }
  }
}

/** The answer handed back by claude-code-action (its structured_output), from an env var or file. */
function readClaudeAnswer(opts) {
  const raw = opts.answerFile && fs.existsSync(opts.answerFile)
    ? fs.readFileSync(opts.answerFile, 'utf-8')
    : (process.env[opts.answerEnv] ?? '');
  if (!raw.trim()) return { error: 'Claude Code did not answer (the step was skipped or failed — is the CLAUDE_CODE_OAUTH_TOKEN secret set, and does the PR author have write access?)' };
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.results)) return { error: 'Claude Code answer has no results array' };
    return { results: parsed.results };
  } catch (err) {
    return { error: `Claude Code answer is not valid JSON: ${err.message}` };
  }
}

// ── Running Playwright ────────────────────────────────────────────────────────

function rerunFailed(opts, reportFile) {
  const cli = require.resolve('@playwright/test/cli', { paths: [opts.root] });
  const args = [cli, 'test', '--last-failed', '--reporter=json', ...(opts.config ? ['--config', opts.config] : [])];
  const r = spawnSync(process.execPath, args, {
    cwd: opts.root, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile },
  });
  const report = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf-8')) : null;
  return { status: r.status, report, output: stripAnsi(`${r.stdout}${r.stderr}`) };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const STATE_FILE = 'state.json';

function saveState(out, state) {
  const backups = Object.fromEntries([...state.backups].map(([k, v]) => [k, Buffer.from(v, 'utf-8').toString('base64')]));
  fs.writeFileSync(path.join(out, STATE_FILE), JSON.stringify({ ...state, backups }, null, 2), 'utf-8');
}

function loadState(out) {
  const file = path.join(out, STATE_FILE);
  if (!fs.existsSync(file)) throw new Error(`--resume: no ${file} — run the healer with --claude-request first`);
  const s = JSON.parse(fs.readFileSync(file, 'utf-8'));
  s.backups = new Map(Object.entries(s.backups).map(([k, v]) => [k, Buffer.from(v, 'base64').toString('utf-8')]));
  return s;
}

/** For GitHub Actions: result = healed | failed | needs_claude. */
function setOutput(key, value) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`, 'utf-8');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const out = path.resolve(opts.root, opts.out);
  fs.mkdirSync(out, { recursive: true });
  // The schema goes into claude_args inside single quotes, so it must not contain one.
  const schema = JSON.stringify(LOCATOR_FIX_SCHEMA);
  if (schema.includes("'")) throw new Error('LOCATOR_FIX_SCHEMA must not contain single quotes');
  setOutput('schema', schema);

  // Second invocation of the Claude Code route: pick up where pass 1 stopped.
  if (opts.resume) {
    const state = loadState(out);
    const answer = readClaudeAnswer(opts);
    state.summary.claude = answer.error ? { error: answer.error } : { asked: state.pending.length, via: 'claude-code' };
    applyClaudeResults(answer, state.pending, state.summary, state.backups, opts);
    return finalize(state.summary, state.failureTitles, state.backups, opts, out);
  }

  if (!opts.report) throw new Error('--report <playwright json report> is required');
  const report = JSON.parse(fs.readFileSync(path.resolve(opts.root, opts.report), 'utf-8'));
  const failures = failedTests(report, opts.root);
  const summary = { failed: failures.length, healed: [], unhealed: [], claude: null, rerun: null };
  if (!failures.length) return finish(summary, out, 0);

  // Pass 1 — deterministic
  const backups = new Map();
  const pending = []; // locator failures for Claude
  for (const f of failures) {
    const loc = failingLocator(f.message);
    const base = { test: f.title, file: f.file, line: f.line, locator: loc?.raw ?? null };
    if (!loc || loc.kind === 'found') { summary.unhealed.push({ ...base, reason: loc ? 'the element was found — the assertion itself failed (real failure)' : 'not a locator failure' }); continue; }
    if (loc.kind === 'strict') { pending.push({ f, base, reason: 'locator matched several elements' }); continue; }
    const parsed = parseLocator(loc.raw);
    const fix = parsed ? deterministicFix(parsed, f.snapshot) : { reason: 'locator form not handled deterministically' };
    if (!fix.newValue) { pending.push({ f, base, reason: fix.reason }); continue; }
    const where = locateSource(parsed, f, opts);
    if (where.reason) { pending.push({ f, base, reason: where.reason }); continue; }
    const applied = applyPatch(where, fix.newValue, backups);
    summary.healed.push({
      ...base, engine: 'deterministic', score: Number(fix.score.toFixed(2)),
      editedFile: posix(path.relative(opts.root, where.file)), editedLine: applied.line,
      from: unescapeJs(parsed.value), to: fix.newValue,
    });
  }
  const failureTitles = failures.map((f) => f.title);

  // Pass 2 — Claude, for locator failures pass 1 couldn't place
  if (pending.length && opts.claudeRequest) {
    // Claude Code route: hand the remaining failures to claude-code-action, then resume.
    writeClaudeRequest(path.resolve(opts.root, opts.claudeRequest), pending.map((p) => p.f), opts);
    saveState(out, { summary, pending, backups, failureTitles });
    setOutput('result', 'needs_claude');
    console.log(`[heal-locators] ${summary.healed.length} healed deterministically; ${pending.length} handed to Claude Code (${opts.claudeRequest})`);
    return;
  }
  if (pending.length && opts.claude && process.env.ANTHROPIC_API_KEY) {
    try {
      const res = await claudeFixes(pending.map((p) => p.f), opts);
      summary.claude = res.error ? { error: res.error } : { asked: pending.length, via: 'api' };
      applyClaudeResults(res, pending, summary, backups, opts);
    } catch (err) {
      summary.claude = { error: err.message };
      for (const p of pending) summary.unhealed.push({ ...p.base, reason: `${p.reason}; Claude call failed` });
    }
  } else {
    for (const p of pending) summary.unhealed.push({ ...p.base, reason: p.reason + (opts.claude ? ' (Claude skipped: no ANTHROPIC_API_KEY)' : '') });
  }
  return finalize(summary, failureTitles, backups, opts, out);
}

/** Re-run the failed tests with the healed locators; keep only fixes that made their test pass. */
function finalize(summary, failureTitles, backups, opts, out) {
  if (!summary.healed.length) return finish(summary, out, 1);
  const rerun = rerunFailed(opts, path.join(out, 'rerun.json'));
  const stillFailing = new Set(rerun.report ? failedTests(rerun.report, opts.root).map((f) => f.title) : failureTitles);
  summary.rerun = { passed: !stillFailing.size, stillFailing: [...stillFailing] };
  const kept = summary.healed.filter((h) => !stillFailing.has(h.test));
  const dropped = summary.healed.filter((h) => stillFailing.has(h.test));
  for (const h of dropped) summary.unhealed.push({ ...h, reason: `fix ${JSON.stringify(h.to)} did not make the test pass` });
  // Revert files whose fixes didn't hold (a file shared by a kept fix keeps its edits).
  const keepFiles = new Set(kept.map((h) => path.resolve(opts.root, h.editedFile)));
  for (const [file, original] of backups) if (!keepFiles.has(file)) fs.writeFileSync(file, original, 'utf-8');
  summary.healed = kept;
  writePatch(opts, out, keepFiles);
  return finish(summary, out, stillFailing.size ? 1 : 0);
}

function writePatch(opts, out, keepFiles) {
  const chunks = [];
  for (const file of keepFiles) {
    const rel = posix(path.relative(opts.root, file));
    const r = spawnSync('git', ['diff', '--no-color', '--', rel], { cwd: opts.root, encoding: 'utf-8' });
    if (r.stdout) chunks.push(r.stdout);
  }
  fs.writeFileSync(path.join(out, 'healed.patch'), chunks.join(''), 'utf-8');
}

function finish(summary, out, code) {
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf-8');
  fs.writeFileSync(path.join(out, 'comment.md'), commentMarkdown(summary, code), 'utf-8');
  const line = `[heal-locators] ${summary.failed} failed · ${summary.healed.length} healed · ${summary.unhealed.length} not healed${summary.rerun ? ` · re-run ${summary.rerun.passed ? 'passed' : 'still failing'}` : ''}`;
  console.log(line);
  for (const h of summary.healed) console.log(`  ✓ ${h.test}: ${h.editedFile}:${h.editedLine} ${JSON.stringify(h.from)} → ${JSON.stringify(h.to)} (${h.engine})`);
  for (const u of summary.unhealed) console.log(`  ✗ ${u.test}: ${u.reason}`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, commentMarkdown(summary, code), 'utf-8');
  setOutput('result', code === 0 ? 'healed' : 'failed');
  process.exitCode = code;
}

function commentMarkdown(summary, code) {
  const lines = ['<!-- locator-heal -->', '## 🩹 Locator healing'];
  if (!summary.failed) return [...lines, '', 'No failures — nothing to heal.', ''].join('\n');
  lines.push('');
  lines.push(code === 0
    ? `**${summary.healed.length} drifted locator(s) healed; the smoke tests pass with the fix.** The check passed using healed locators that are **not yet in your branch** — apply the fix below so the next run doesn't depend on healing.`
    : `**${summary.unhealed.length} failure(s) could not be healed** — see below.${summary.healed.length ? ` ${summary.healed.length} locator(s) were healed.` : ''}`);
  if (summary.healed.length) {
    lines.push('', '| Test | Where | Was | Now | How |', '|---|---|---|---|---|');
    for (const h of summary.healed) lines.push(`| ${h.test} | \`${h.editedFile}:${h.editedLine}\` | \`${h.from}\` | \`${h.to}\` | ${h.engine === 'claude' ? `Claude — ${h.reasonText ?? ''}` : `closest match (${h.score})`} |`);
    lines.push('', 'Apply it locally: download the **healed-locators** artifact from this run and run `git apply healed.patch`.');
  }
  if (summary.unhealed.length) {
    lines.push('', '**Not healed** (real failures or not safely fixable):', '');
    for (const u of summary.unhealed) lines.push(`- **${u.test}** — ${u.reason}`);
  }
  if (summary.claude?.error) lines.push('', `_Claude fallback unavailable: ${summary.claude.error}_`);
  return lines.join('\n') + '\n';
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[heal-locators] ${err.stack ?? err.message}`);
    process.exitCode = 2;
  });
}

module.exports = { failingLocator, parseLocator, parseSnapshot, deterministicFix, withoutLocators, validClaudeEdit, similarity, LOCATOR_FIX_SCHEMA };
