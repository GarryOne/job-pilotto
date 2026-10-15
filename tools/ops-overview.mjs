#!/usr/bin/env node
// Publishes the merged PRs of the last 30 days to the owner's page /admin/operations/overview (ops-overview.yml: every push to main, hourly). Only PRs the site does not hold yet are looked up
// (GET /ops/data lists the stored ones), at most 150 a run, newest first: a PR is read once. Category and row come from site/src/ops-categories.js (guard: site/test/ops-overview.test.js).
// CI minutes = the wall time of each workflow run on the PR's branch, summed (not GitHub's billed minutes: parallel jobs are not multiplied).
//   node tools/ops-overview.mjs [--dry [--out rows.json]]     needs gh with GH_TOKEN; publishing needs SELFHEAL_PUBLISH_KEY (optional OPS_URL); --dry prints the counts, --out saves the rows
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {RULES_VERSION, prRow} from '../site/src/ops-categories.js';

const repo = process.env.GITHUB_REPOSITORY || process.env.REPO || 'GarryOne/job-pilotto';
const base = process.env.OPS_URL || 'https://www.jobpilotto.top/ops/data';
const gh = (...args) => JSON.parse(execFileSync('gh', args, {encoding: 'utf8', maxBuffer: 1 << 28}) || 'null');

export function ciMinutes(runs) {
  return (runs || []).reduce((sum, run) => sum + Math.max(0, (Date.parse(run.updated_at) - Date.parse(run.run_started_at || run.created_at)) / 60000 || 0), 0);
}

async function main() {
  const key = process.env.SELFHEAL_PUBLISH_KEY, dry = process.argv.includes('--dry');
  if (!key && !dry) { console.log('::warning::SELFHEAL_PUBLISH_KEY is not set: nothing published.'); return; }
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const merged = gh('pr', 'list', '--repo', repo, '--state', 'merged', '--search', `merged:>=${since}`, '--limit', '1500', '--json', 'number,mergedAt');
  let have = [];
  if (key) have = (await (await fetch(`${base}?v=${RULES_VERSION}`, {headers: {Authorization: `Bearer ${key}`}})).json()).have || [];
  const known = new Set(have);
  const fresh = merged.filter(pr => !known.has(pr.number)).sort((a, b) => b.mergedAt.localeCompare(a.mergedAt)).slice(0, 150);
  console.log(`${merged.length} merged in 30 days, ${known.size} stored, ${fresh.length} to read`);
  const rows = [];
  for (const {number} of fresh) {
    const pr = gh('pr', 'view', String(number), '--repo', repo, '--json', 'number,title,createdAt,mergedAt,headRefName,files,commits');
    let runs = [];
    try { runs = gh('api', `repos/${repo}/actions/runs?branch=${encodeURIComponent(pr.headRefName)}&per_page=100`).workflow_runs || []; } catch { /* no runs found: 0 minutes */ }
    rows.push(prRow(pr, ciMinutes(runs.filter(run => Date.parse(run.created_at) <= Date.parse(pr.mergedAt)))));
  }
  const counts = {};
  for (const row of rows) counts[row.category] = (counts[row.category] || 0) + 1;
  console.log(JSON.stringify(counts));
  const out = process.argv.indexOf('--out');
  if (out > 0) writeFileSync(process.argv[out + 1], JSON.stringify(rows));
  if (dry) return;
  const response = await fetch(base, {method: 'PUT', headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'}, body: JSON.stringify({rules: RULES_VERSION, prs: rows})});
  console.log(`published ${rows.length}: HTTP ${response.status} ${await response.text()}`);
  if (!response.ok) process.exitCode = 1;
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
