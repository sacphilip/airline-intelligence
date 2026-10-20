#!/usr/bin/env node
/**
 * Post the locator healer's result on the pull request.
 *
 * - One sticky PR comment (updated on every run, never duplicated) with the healed
 *   locators, what wasn't healed, and how to apply the fix.
 * - One-click "suggested changes" for healed lines that are part of the PR's diff.
 *   GitHub only allows suggestions on diff lines; healed lines elsewhere (the usual case
 *   when the PR changed the app, not the tests) are covered by the comment + patch.
 *
 * Usage: node scripts/ci/post-heal-comment.cjs [--dir heal-report]
 * Env: GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_EVENT_PATH (set by GitHub Actions),
 *      GITHUB_SERVER_URL, GITHUB_RUN_ID. Never fails the job: problems are logged.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const MARKER = '<!-- locator-heal -->';
const dirArg = process.argv.indexOf('--dir');
const dir = path.resolve(dirArg > -1 ? process.argv[dirArg + 1] : 'heal-report');

const api = async (method, url, body) => {
  const res = await fetch(`https://api.github.com${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw Object.assign(new Error(`${method} ${url} → ${res.status} ${(await res.text()).slice(0, 300)}`), { status: res.status });
  return res.status === 204 ? null : res.json();
};

async function paginate(url) {
  const all = [];
  for (let page = 1; page < 30; page++) {
    const batch = await api('GET', `${url}${url.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

/** Right-side line numbers covered by each file's diff hunks. */
function diffLines(files) {
  const map = new Map();
  for (const f of files) {
    const lines = new Set();
    let right = 0;
    for (const l of (f.patch ?? '').split('\n')) {
      const h = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (h) { right = Number(h[1]); continue; }
      if (l.startsWith('-')) continue;
      if (l.startsWith('+') || l.startsWith(' ')) { lines.add(right); right++; }
    }
    map.set(f.filename, lines);
  }
  return map;
}

async function main() {
  const summaryFile = path.join(dir, 'summary.json');
  if (!fs.existsSync(summaryFile)) { console.log('[post-heal-comment] no healer summary — nothing to post'); return; }
  if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_EVENT_PATH) { console.log('[post-heal-comment] not running in GitHub Actions — skipping'); return; }

  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf-8'));
  const pr = event.pull_request;
  if (!pr) { console.log('[post-heal-comment] not a pull_request event — skipping'); return; }
  const repo = process.env.GITHUB_REPOSITORY;
  const summary = JSON.parse(fs.readFileSync(summaryFile, 'utf-8'));
  const runUrl = `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  let body = fs.readFileSync(path.join(dir, 'comment.md'), 'utf-8');
  body += `\n<sub>From [this run](${runUrl}) · commit ${pr.head.sha.slice(0, 7)} · artifact **healed-locators**</sub>\n`;

  // Inline suggestions where GitHub allows them (lines in the PR diff).
  const inDiff = diffLines(await paginate(`/repos/${repo}/pulls/${pr.number}/files`));
  const comments = [];
  for (const h of summary.healed ?? []) {
    if (!inDiff.get(h.editedFile)?.has(h.editedLine)) continue;
    const text = fs.readFileSync(h.editedFile, 'utf-8').split(/\r?\n/)[h.editedLine - 1];
    comments.push({ path: h.editedFile, line: h.editedLine, side: 'RIGHT', body: `🩹 Locator drift: \`${h.from}\` no longer matches the page.\n\n\`\`\`suggestion\n${text}\n\`\`\`` });
  }
  if (comments.length) {
    await api('POST', `/repos/${repo}/pulls/${pr.number}/reviews`, { commit_id: pr.head.sha, event: 'COMMENT', body: 'Suggested fixes for drifted locators (see the healing comment for details).', comments });
    body = body.replace('Apply it locally:', `${comments.length} of them are suggested inline below — accept them there, or apply all locally:`);
  }

  // One sticky comment.
  const existing = (await paginate(`/repos/${repo}/issues/${pr.number}/comments`)).find((c) => c.body?.includes(MARKER));
  if (existing) await api('PATCH', `/repos/${repo}/issues/comments/${existing.id}`, { body });
  else await api('POST', `/repos/${repo}/issues/${pr.number}/comments`, { body });
  console.log(`[post-heal-comment] ${existing ? 'updated' : 'posted'} PR comment${comments.length ? `, ${comments.length} inline suggestion(s)` : ''}`);
}

main().catch((err) => {
  // PRs from forks get a read-only token: report in the job log and summary instead.
  const why = err.status === 403 ? 'no permission to comment (PR from a fork?)' : err.message;
  console.log(`::warning::Couldn't post the locator-healing comment: ${why}. See the job summary and the healed-locators artifact.`);
});
