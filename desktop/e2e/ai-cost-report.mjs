// Every scheduled AI job tells the owner's page https://www.jobpilotto.workers.dev/ai-cost what it spent (site/src/aicost.js). Never fails a job:
// a missing key, an unreadable record or an unreachable site only prints a line.
//   node ai-cost-report.mjs --job <id> (--execution <claude-code-action output> | --file <{usd, calls}> | --usd <n> [--calls <n>]) [--suffix <matrix key>]
//   node ai-cost-report.mjs --billed [--days 7]     what Anthropic itself billed per day (Admin API, ANTHROPIC_ADMIN_KEY), to see what the jobs miss;
//                                                    with AI_COST_KEYS=<name,name> also what each of those API keys cost per day (sent by NAME only)
// Env: AI_COST_PUBLISH_KEY; GITHUB_RUN_ID / GITHUB_RUN_ATTEMPT / GITHUB_REPOSITORY (set by Actions).
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {outcome} from './ai-budget.mjs';
import {PRICES} from './lib/vision.mjs';

const SITE = process.env.AI_COST_SITE || 'https://www.jobpilotto.workers.dev';

// {usd, calls} of one run from whichever record the job leaves.
export function spent({execution, file, usd, calls}) {
  if (execution !== undefined) { const result = outcome(execution); return {usd: result.usd, calls: result.turns}; }
  if (file !== undefined) { try { const data = JSON.parse(file); return {usd: Number(data.usd ?? data.spent) || 0, calls: Number(data.calls ?? data.turns ?? data.considered) || 0}; } catch { return null; } }
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

// The Admin API's cost report cannot split by API key, its usage report can. So each day's real price per token comes from the cost report (amount of each
// model x tier x token type, over the tokens all keys used of it), and a key's cost is its own tokens at those prices: the keys add up to the bill.
const TYPES = ['uncached_input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation.ephemeral_5m_input_tokens', 'cache_creation.ephemeral_1h_input_tokens'];
const tokensOf = (row, type) => Number(type.startsWith('cache_creation.') ? row.cache_creation?.[type.slice(15)] : row[type]) || 0;
const modelOf = model => String(model || '').replace(/-\d{8}$/, '');
const LIST = {uncached_input_tokens: 1, output_tokens: 0, cache_read_input_tokens: 0.1, 'cache_creation.ephemeral_5m_input_tokens': 1.25, 'cache_creation.ephemeral_1h_input_tokens': 2};
const listPrice = (model, type) => { const price = PRICES[modelOf(model)]; return price ? (type === 'output_tokens' ? price.output : price.input * LIST[type]) / 1e6 : 0; };   // only when the bill lacks the line

// usage: [{day, api_key_id, model, service_tier, ...tokens}] of EVERY key; names: {id: name}; lines: cost report rows [{day, model, service_tier, token_type, amount (cents)}];
// tracked: key names -> [{day, key, usd}].
export function keyDays(usage, names, lines, tracked) {
  const id = (day, model, tier, type) => `${day}|${modelOf(model)}|${tier || 'standard'}|${type}`;
  const billedAmount = {}, used = {};
  for (const line of lines) if (TYPES.includes(line.token_type)) { const k = id(line.day, line.model, line.service_tier, line.token_type); billedAmount[k] = (billedAmount[k] || 0) + (Number(line.amount) || 0) / 100; }
  for (const row of usage) for (const type of TYPES) { const k = id(row.day, row.model, row.service_tier, type); used[k] = (used[k] || 0) + tokensOf(row, type); }
  const out = {};
  for (const row of usage) {
    const name = names[row.api_key_id];
    if (!tracked.includes(name)) continue;
    for (const type of TYPES) {
      const n = tokensOf(row, type);
      if (!n) continue;
      const k = id(row.day, row.model, row.service_tier, type), rate = billedAmount[k] !== undefined && used[k] > 0 ? billedAmount[k] / used[k] : listPrice(row.model, type);
      out[`${row.day}|${name}`] = (out[`${row.day}|${name}`] || 0) + n * rate;
    }
  }
  return Object.entries(out).map(([k, usd]) => { const [day, key] = k.split('|'); return {day, key, usd: Math.round(usd * 1e6) / 1e6}; });
}

const admin = (path, fetcher) => fetcher(`https://api.anthropic.com${path}`, {headers: {'x-api-key': process.env.ANTHROPIC_ADMIN_KEY, 'anthropic-version': '2023-06-01'}})
  .then(async response => { if (!response.ok) throw new Error(`Anthropic answered ${response.status}`); return response.json(); });
// Every page of a report: -> [{day, ...row}].
async function report(path, fetcher) {
  const rows = [];
  let next = '';
  for (let i = 0; i < 20; i++) {
    const page = await admin(`${path}${next ? `&page=${encodeURIComponent(next)}` : ''}`, fetcher);
    for (const bucket of page.data || []) for (const row of bucket.results || []) rows.push({day: String(bucket.starting_at).slice(0, 10), ...row});
    if (!page.has_more || !page.next_page) break;
    next = page.next_page;
  }
  return rows;
}

export async function fetchKeyDays(days, tracked, fetcher = fetch, now = new Date()) {
  const names = {};
  let after = '';
  for (let i = 0; i < 10; i++) {
    const page = await admin(`/v1/organizations/api_keys?limit=100${after ? `&after_id=${after}` : ''}`, fetcher);
    for (const key of page.data || []) names[key.id] = key.name;
    if (!page.has_more) break;
    after = page.last_id;
  }
  const start = encodeURIComponent(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days)).toISOString());
  const usage = await report(`/v1/organizations/usage_report/messages?starting_at=${start}&bucket_width=1d&limit=31&group_by[]=api_key_id&group_by[]=model&group_by[]=service_tier`, fetcher);
  const lines = await report(`/v1/organizations/cost_report?starting_at=${start}&bucket_width=1d&limit=31&group_by[]=description`, fetcher);
  return keyDays(usage, names, lines, tracked);
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
      else {
        const days = Number(at('--days')) || 7, billed = await fetchBilled(days);
        const tracked = String(process.env.AI_COST_KEYS || '').split(',').map(name => name.trim()).filter(Boolean);
        const keys = tracked.length ? await fetchKeyDays(days, tracked).catch(error => { console.log(`Per-key cost not fetched: ${error.message}`); return []; }) : [];
        await put({billed, keys});
        console.log(`Billed cost published for ${billed.length} day(s): $${billed.reduce((s, d) => s + d.usd, 0).toFixed(2)}${tracked.length ? `; ${tracked.map(name => `${name} $${keys.filter(k => k.key === name).reduce((s, k) => s + k.usd, 0).toFixed(2)}`).join(', ')}` : ''}.`);
      }
    } else {
      const job = at('--job'), figures = spent({execution: read('--execution'), file: read('--file'), usd: at('--usd'), calls: at('--calls')});
      if (!job || !figures) console.log(`AI cost not reported (${job || 'no --job'}): no figure to report.`);
      else { const row = runRow({job, suffix: at('--suffix'), ...figures}); await put({runs: [row]}); console.log(`AI cost reported: ${job} $${row.usd.toFixed(3)} (${row.calls} call(s)), run ${row.run_id}.`); }
    }
  } catch (error) { console.log(`AI cost not reported: ${error.message}`); }
}
