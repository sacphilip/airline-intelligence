#!/usr/bin/env node
/**
 * Open a pull request into develop with the fixes a CI healer made.
 *
 * Both healers leave only verified fixes in the working tree: the locator healer
 * (scripts/ci/heal-locators.cjs) keeps a fix only if its test passed on re-run, and the
 * API healer (apps/qa-api-orchestrator ci-heal) runs before a passing re-run. This script
 * takes those edits from the test directories, applies them to a fresh branch cut from the
 * base branch, and opens a PR, so the fix lands without anyone downloading an artifact.
 *
 * - Works for pull_request runs (the checkout is the PR merge commit) and for pushes to
 *   develop: the branch is always cut from origin/<base>, never from the PR.
 * - Idempotent: the branch is named after the patch hash, so the same fix never opens two PRs.
 * - Skips when the fix is already on the base branch or does not apply to it.
 * - On a pull_request run, comments on the source PR with a link to the heal PR.
 *
 * Usage: node scripts/ci/open-heal-pr.cjs --source "UI smoke" [--base develop]
 *        [--paths tests,apps/qa-api-orchestrator/tests] [--summary heal-report/summary.json]
 * Env:   GITHUB_TOKEN (contents: write, pull-requests: write), GITHUB_REPOSITORY,
 *        GITHUB_EVENT_NAME, GITHUB_EVENT_PATH, GITHUB_SERVER_URL, GITHUB_RUN_ID, GITHUB_SHA.
 *        Pass a PAT or GitHub App token as GITHUB_TOKEN if the heal PR should trigger CI:
 *        PRs opened with the default workflow token do not start workflows.
 *        HEAL_PR_PUSH_URL overrides the push remote (local testing).
 * Never fails the job: problems are logged as warnings.
 */
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const source = arg('source', 'CI');
const base = arg('base', 'develop');
const paths = arg('paths', 'tests,apps/qa-api-orchestrator/tests').split(',').map((p) => p.trim()).filter(Boolean);
const summaryFile = arg('summary', null);

const env = process.env;
const repo = env.GITHUB_REPOSITORY;
const pushUrl = env.HEAL_PR_PUSH_URL || `https://x-access-token:${env.GITHUB_TOKEN}@github.com/${repo}.git`;
const runUrl = `${env.GITHUB_SERVER_URL || 'https://github.com'}/${repo}/actions/runs/${env.GITHUB_RUN_ID}`;

function git(args, opts = {}) {
  const r = spawnSync('git', args, { encoding: 'utf-8', ...opts });
  if (r.status !== 0 && !opts.allowFail) throw new Error(`git ${args.join(' ')} → ${(r.stderr || r.stdout).trim()}`);
  return r;
}

const api = async (method, url, body) => {
  const res = await fetch(`https://api.github.com${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw Object.assign(new Error(`${method} ${url} → ${res.status} ${(await res.text()).slice(0, 300)}`), { status: res.status });
  return res.status === 204 ? null : res.json();
};

function healedTable() {
  if (!summaryFile || !fs.existsSync(summaryFile)) return '';
  try {
    const s = JSON.parse(fs.readFileSync(summaryFile, 'utf-8'));
    const healed = s.healed || [];
    if (Array.isArray(healed) && healed.length) {
      const cell = (v) => `\`${String(v ?? '').replace(/\|/g, '\\|').replace(/`/g, "'")}\``;
      return ['| Test | Where | Was | Now | How |', '|---|---|---|---|---|',
        ...healed.map((h) => `| ${h.test} | ${cell(`${h.editedFile}:${h.editedLine}`)} | ${cell(h.from)} | ${cell(h.to)} | ${h.engine === 'claude' ? `Claude — ${h.reason || ''}` : 'deterministic'} |`),
        ''].join('\n');
    }
    if (Array.isArray(s.entries) && s.entries.length) {
      return [...s.entries.filter((e) => e.healable).map((e) => `- **${e.title}** — ${e.classification}: ${e.rootCause || ''}`), ''].join('\n');
    }
  } catch { /* the patch below is the source of truth */ }
  return '';
}

async function main() {
  if (!env.GITHUB_TOKEN || !repo) return console.log('::warning::open-heal-pr: GITHUB_TOKEN / GITHUB_REPOSITORY not set — skipping.');

  // Only tracked files inside the test directories; reports and artifacts never ride along.
  const patch = git(['diff', '--no-color', '--binary', '--', ...paths]).stdout;
  if (!patch.trim()) return console.log('open-heal-pr: the healer left no changes in', paths.join(', '), '— nothing to open.');
  const files = git(['diff', '--name-only', '--', ...paths]).stdout.trim().split('\n');
  const hash = crypto.createHash('sha256').update(patch).digest('hex').slice(0, 10);
  const branch = `heal/${hash}`;

  const patchFile = `${env.RUNNER_TEMP || '.'}/heal-${hash}.patch`;
  fs.writeFileSync(patchFile, patch, 'utf-8');

  // Cut the branch from the base branch, not from the checkout (on a PR run that is the merge commit).
  git(['fetch', '--no-tags', '--depth=1', 'origin', `+refs/heads/${base}:refs/remotes/origin/${base}`]);
  if (git(['ls-remote', '--exit-code', '--heads', 'origin', branch], { allowFail: true }).status === 0) {
    return console.log(`open-heal-pr: ${branch} already exists — this fix already has a PR.`);
  }
  // The patch is saved; the healed checkout isn't needed any more (this runs at the end of the job).
  git(['switch', '--quiet', '--force', '--detach', `origin/${base}`]);
  if (git(['apply', '--check', '--reverse', patchFile], { allowFail: true }).status === 0) {
    return console.log(`open-heal-pr: the fix is already on ${base} — nothing to open.`);
  }
  if (git(['apply', '--check', patchFile], { allowFail: true }).status !== 0) {
    return console.log(`::warning::open-heal-pr: the healed fix does not apply to ${base} (the drifted lines only exist on this branch) — no heal PR opened; apply healed.patch to the branch instead.`);
  }
  git(['apply', patchFile]);
  git(['switch', '--quiet', '-C', branch]);
  git(['add', '--', ...files]);

  const event = env.GITHUB_EVENT_PATH && fs.existsSync(env.GITHUB_EVENT_PATH) ? JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf-8')) : {};
  const sourcePr = event.pull_request;
  const origin = sourcePr ? `PR #${sourcePr.number}` : `${base}@${(env.GITHUB_SHA || '').slice(0, 7)}`;
  const title = `fix(tests): healed ${source} tests (${files.length} file${files.length === 1 ? '' : 's'})`;
  git(['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
    'commit', '--quiet', '-m', title, '-m', `Healed by CI in ${runUrl} (from ${origin}). Every fix passed its test on re-run.`]);

  const push = git(['push', pushUrl, `HEAD:refs/heads/${branch}`], { allowFail: true });
  if (push.status !== 0) {
    return console.log(`::warning::open-heal-pr: could not push ${branch} (fork PRs and read-only tokens can't) — ${push.stderr.replace(env.GITHUB_TOKEN, '***').trim().split('\n').pop()}`);
  }

  const body = [
    `The **${source}** tests failed in [this run](${runUrl}) (${origin}) and the CI healer fixed them. Every fix below passed its test on re-run.`,
    '',
    healedTable(),
    '<details><summary>Patch</summary>', '', '```diff', patch.trimEnd(), '```', '', '</details>',
    '',
    sourcePr ? `Merging this keeps \`${base}\` from depending on healing once #${sourcePr.number} merges.` : `\`${base}\` is failing these tests until this merges.`,
    '',
    '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
  ].join('\n');

  let pr;
  try {
    pr = await api('POST', `/repos/${repo}/pulls`, { title, head: branch, base, body, maintainer_can_modify: true });
  } catch (e) {
    const hint = e.status === 403 ? ' Enable Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests".' : '';
    git(['push', pushUrl, '--delete', branch], { allowFail: true });
    return console.log(`::warning::open-heal-pr: could not open the PR — ${e.message}.${hint}`);
  }
  console.log(`open-heal-pr: opened ${pr.html_url}`);
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `pr_url=${pr.html_url}\n`);
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `\n**Heal PR:** ${pr.html_url}\n`);

  if (sourcePr) {
    await api('POST', `/repos/${repo}/issues/${sourcePr.number}/comments`, {
      body: `🩹 The healed ${source} fix is in ${pr.html_url} (into \`${base}\`).`,
    }).catch((e) => console.log(`::warning::open-heal-pr: could not comment on #${sourcePr.number} — ${e.message}`));
  }
}

main().catch((e) => console.log(`::warning::open-heal-pr: ${e.message.replace(env.GITHUB_TOKEN || '\0', '***')}`));
