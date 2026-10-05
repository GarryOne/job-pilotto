// Collects the self-healing loop's numbers and publishes them to the owner's page /self-heal (self-heal-stats.yml, every 3 hours).
//   node selfheal-stats.mjs [--publish]        (needs gh with GH_TOKEN; --publish needs SELFHEAL_PUBLISH_KEY, optional SELFHEAL_URL)
// The site keeps one snapshot per day (D1 selfheal_snapshots), so the page shows a trend, not only today.
import {loopQuality} from './lib/loop-quality.mjs';
import {asIssues, REGISTER_LIST, registerEntries} from './lib/prejudge.mjs';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from './lib/selfheal-stats.mjs';

const gh = args => execFileSync('gh', args, {encoding: 'utf8', maxBuffer: 50 * 1024 * 1024});
const repo = () => process.env.REPO || process.env.GITHUB_REPOSITORY || 'GarryOne/job-pilotto';

export async function collect({days = 30} = {}) {
  const filed = JSON.parse(gh(['issue', 'list', '--label', 'auto-ui', '--state', 'all', '--limit', '1000', '--json', 'number,title,state,stateReason,labels,comments,createdAt,url']));
  // Plus what was judged noise before filing (the noise register): still a false positive of its detector, or precision would look better than it is.
  let judged = [];
  try { judged = asIssues(registerEntries(JSON.parse(gh(REGISTER_LIST))[0]?.body)); } catch { judged = []; }
  const issues = [...filed, ...judged];
  const prs = JSON.parse(gh(['pr', 'list', '--label', 'auto-ui-fix', '--state', 'all', '--limit', '200', '--json', 'state,createdAt,comments']))
    .map(pr => ({state: pr.state, createdAt: pr.createdAt, closingNote: (pr.comments || []).at(-1)?.body || ''}));
  // What the AI cost: the ai-cost artifacts the fixer, the verdict pass and the code review leave (desktop/e2e/ai-budget.mjs), last `days` days, at most 300.
  const since = Date.now() - days * 86400000, costs = [];
  let listed = [];
  // --paginate prints one JSON array per page, an empty page as []: each line is parsed on its own.
  try { listed = gh(['api', `repos/${repo()}/actions/artifacts?per_page=100`, '--paginate', '--jq', '[.artifacts[] | select(.name | startswith("ai-cost")) | {id, created_at, expired}]']).split('\n').filter(line => line.trim()).flatMap(line => JSON.parse(line)); } catch (error) { console.log(`cost artifacts not listed: ${String(error.message).slice(0, 160)}`); }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-'));
  for (const item of listed.filter(entry => !entry.expired && Date.parse(entry.created_at) >= since).slice(0, 300)) {
    try {
      const zip = path.join(tmp, `${item.id}.zip`);
      fs.writeFileSync(zip, execFileSync('gh', ['api', `repos/${repo()}/actions/artifacts/${item.id}/zip`], {maxBuffer: 5 * 1024 * 1024}));
      costs.push(JSON.parse(execFileSync('unzip', ['-p', zip, 'ai-cost.json'], {encoding: 'utf8'})));
    } catch { /* an artifact that cannot be read is left out */ }
  }
  // Recall: the planted bugs of the latest interactions run that has a recall.json.
  let recall = null;
  try {
    const runs = JSON.parse(gh(['run', 'list', '--workflow', 'e2e.yml', '--status', 'completed', '--limit', '10', '--json', 'databaseId']));
    for (const run of runs) {
      const dir = path.join(tmp, `run-${run.databaseId}`);
      try { execFileSync('gh', ['run', 'download', String(run.databaseId), '-n', 'e2e-artifacts-interactions', '-D', dir], {stdio: 'ignore'}); } catch { continue; }
      const file = path.join(dir, 'recall.json');
      if (fs.existsSync(file)) { recall = JSON.parse(fs.readFileSync(file, 'utf8')); break; }
    }
  } catch { /* no recall this time */ }
  // How well the loop does (lib/loop-quality.mjs): the audits, the latest mutation test, and the Bug Tracker's escapes.
  let audits = [], mutation = null, tracker = null, trackerWhy = '';
  try { audits = JSON.parse(gh(['issue', 'list', '--label', 'verdict-audit', '--state', 'all', '--limit', '8', '--json', 'body,createdAt'])).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); } catch { audits = []; }
  try {
    const [latest] = JSON.parse(gh(['api', `repos/${repo()}/actions/artifacts?name=mutation-result&per_page=1`, '--jq', '[.artifacts[] | select(.expired | not) | {id}]']));
    if (latest) {
      const zip = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mutation-')), 'm.zip');
      fs.writeFileSync(zip, execFileSync('gh', ['api', `repos/${repo()}/actions/artifacts/${latest.id}/zip`], {maxBuffer: 5 * 1024 * 1024}));
      mutation = JSON.parse(execFileSync('unzip', ['-p', zip, 'mutation-result.json'], {encoding: 'utf8'}));
    }
  } catch { mutation = null; }
  ({tracker, trackerWhy} = await bugTracker());
  return {...build({issues, prs, costs, recall}), quality: loopQuality({issues, audits, mutation, tracker, trackerWhy})};
}

// The Notion Bug Tracker's rows (every bug, whoever found it), read with the CI's Notion connection; the database id is the BUG_TRACKER_DB variable (no Notion id lives in code).
async function bugTracker() {
  const token = process.env.NOTION_BRAIN_TOKEN, db = process.env.BUG_TRACKER_DB;
  if (!token || !db) return {tracker: null, trackerWhy: 'the Bug Tracker is not connected (NOTION_BRAIN_TOKEN and BUG_TRACKER_DB)'};
  const rows = [];
  let cursor;
  try {
    do {
      const response = await fetch(`https://api.notion.com/v1/databases/${db}/query`, {method: 'POST', headers: {Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json'}, body: JSON.stringify({page_size: 100, ...(cursor ? {start_cursor: cursor} : {})})});
      if (!response.ok) return {tracker: null, trackerWhy: response.status === 404 ? 'the Bug Tracker is not shared with the "Job Pilotto Brain" Notion connection' : `the Bug Tracker answered ${response.status}`};
      const page = await response.json();
      rows.push(...page.results);
      cursor = page.has_more ? page.next_cursor : null;
    } while (cursor && rows.length < 1000);
  } catch (error) { return {tracker: null, trackerWhy: `the Bug Tracker could not be read (${String(error.message).slice(0, 60)})`}; }
  return {tracker: rows, trackerWhy: ''};
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const data = await collect();
  const line = `Self-heal stats: ${data.totals.filed} issues, ${data.totals.real} real (${data.totals.fixed} fixed, ${data.totals.queued} queued), ${data.totals.falsePositive} false positives, precision ${data.totals.precision}%; AI cost $${data.cost.usd} over ${data.cost.runs} runs; recall ${data.recall ? `${data.recall.caught}/${data.recall.planted}` : 'n/a'}; ${Object.entries(data.quality || {}).map(([key, value]) => `${key} ${value.rate === null ? 'n/a' : `${value.rate}%`}`).join(', ')}.`;
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
  if (process.argv.includes('--publish')) {
    const key = process.env.SELFHEAL_PUBLISH_KEY;
    if (!key) { console.log('::warning::SELFHEAL_PUBLISH_KEY is not set: nothing published.'); process.exit(0); }
    const response = await fetch(process.env.SELFHEAL_URL || 'https://www.jobpilotto.workers.dev/self-heal/data', {method: 'PUT', headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'}, body: JSON.stringify(data)});
    console.log(`published: HTTP ${response.status}`);
    if (!response.ok) { console.log(await response.text()); process.exit(1); }
  }
}
