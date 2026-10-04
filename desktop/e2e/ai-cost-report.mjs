// Every scheduled AI job tells the owner's page https://www.jobpilotto.workers.dev/ai-cost what it spent (site/src/aicost.js). Never fails a job:
// a missing key, an unreadable record or an unreachable site only prints a line.
//   node ai-cost-report.mjs --job <id> (--execution <claude-code-action output> | --file <{usd, calls}> | --usd <n> [--calls <n>]) [--suffix <matrix key>]
//   node ai-cost-report.mjs --billed [--days 7]     what Anthropic itself billed per day (Admin API, ANTHROPIC_ADMIN_KEY), to see what the jobs miss
// Env: AI_COST_PUBLISH_KEY; GITHUB_RUN_ID / GITHUB_RUN_ATTEMPT / GITHUB_REPOSITORY (set by Actions).
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {outcome} from './ai-budget.mjs';

const SITE = process.env.AI_COST_SITE || 'https://www.jobpilotto.workers.dev';

// {usd, calls} of one run from whichever record the job leaves.
export function spent({execution, file, usd, calls}) {
  if (execution !== undefined) { const result = outcome(execution); return {usd: result.usd, calls: result.turns}; }
  if (file !== undefined) { try { const data = JSON.parse(file); return {usd: Number(data.usd) || 0, calls: Number(data.calls ?? data.turns) || 0}; } catch { return null; } }
  if (Number.isFinite(Number(usd))) return {usd: Number(usd), calls: Number(calls) || 0};
  return null;
}

export function runRow({job, suffix = '', env = process.env, now = new Date(), usd, calls}) {
  const id = `${env.GITHUB_RUN_ID || `local-${now.getTime()}`}${suffix ? `-${suffix}` : ''}`.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 64);
  return {job, run_id: id, at: now.toISOString(), usd: Math.round(usd * 1e6) / 1e6, calls, repo: env.GITHUB_REPOSITORY || ''};
}

// The Admin API's cost report: one bucket per day, amounts as decimal strings in cents (USD).
export function billedDays(report) {
  return (report?.data || []).map(bucket => ({
    day: String(bucket.starting_at).slice(0, 10),
    usd: (bucket.results || []).reduce((sum, item) => sum + (Number(item.amount) || 0), 0) / 100,
  }));
}

async function put(body, fetcher = fetch) {
  const response = await fetcher(`${SITE}/ai-cost/data`, {method: 'PUT', headers: {Authorization: `Bearer ${process.env.AI_COST_PUBLISH_KEY}`, 'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  if (!response.ok) throw new Error(`site answered ${response.status}`);
}

export async function fetchBilled(days, fetcher = fetch, now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days)).toISOString();
  const all = [];
  let page = '';
  for (let i = 0; i < 5; i++) {
    const url = `https://api.anthropic.com/v1/organizations/cost_report?starting_at=${encodeURIComponent(start)}&bucket_width=1d&limit=31${page ? `&page=${encodeURIComponent(page)}` : ''}`;
    const response = await fetcher(url, {headers: {'x-api-key': process.env.ANTHROPIC_ADMIN_KEY, 'anthropic-version': '2023-06-01'}});
    if (!response.ok) throw new Error(`Anthropic answered ${response.status}`);
    const report = await response.json();
    all.push(...billedDays(report));
    if (!report.has_more || !report.next_page) break;
    page = report.next_page;
  }
  return all;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2), at = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const read = flag => { const name = at(flag); if (name === undefined) return undefined; try { return fs.readFileSync(name, 'utf8'); } catch { return ''; } };
  try {
    if (!process.env.AI_COST_PUBLISH_KEY) console.log('AI cost not reported: AI_COST_PUBLISH_KEY is not set here.');
    else if (args.includes('--billed')) {
      if (!process.env.ANTHROPIC_ADMIN_KEY) console.log('Billed cost not fetched: ANTHROPIC_ADMIN_KEY is not set.');
      else { const billed = await fetchBilled(Number(at('--days')) || 7); await put({billed}); console.log(`Billed cost published for ${billed.length} day(s): $${billed.reduce((s, d) => s + d.usd, 0).toFixed(2)}.`); }
    } else {
      const job = at('--job'), figures = spent({execution: read('--execution'), file: read('--file'), usd: at('--usd'), calls: at('--calls')});
      if (!job || !figures) console.log(`AI cost not reported (${job || 'no --job'}): no figure to report.`);
      else { const row = runRow({job, suffix: at('--suffix'), ...figures}); await put({runs: [row]}); console.log(`AI cost reported: ${job} $${row.usd.toFixed(3)} (${row.calls} call(s)), run ${row.run_id}.`); }
    }
  } catch (error) { console.log(`AI cost not reported: ${error.message}`); }
}
