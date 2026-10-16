#!/usr/bin/env node
// The Free AI quality table (spec docs/superpowers/specs/2026-10-16-free-workers-ai.md "Quality"): runs Anthropic-shaped cases through the site's own
// translation (site/src/free-ai-translate.js) on Workers AI models and prints a markdown table: valid JSON, schema, rank against Claude's scores, cost.
//   node tools/free-ai-eval.mjs --cases <cases.json> [--models small,strong] [--backend rest|mock] [--out table.md]
// Cases (made by tools/free-ai-cases.py, fictional data only): [{id, action, params: <Anthropic request>, baseline?: <Claude's score>}].
// rest: needs a token with Account > Workers AI > Read + Edit: CF_API_TOKEN or the Keychain item job-pilotto.cloudflare.workers_ai_token; --account <id> names the Cloudflare account the token belongs to, never the production one (its free daily allowance is the live Free AI's). A few hundred calls cost cents.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {costUsd, SMALL, STRONG} from '../site/src/free-ai-models.js';
import {fromWorkersAi, toWorkersAi} from '../site/src/free-ai-translate.js';
import {answerProblems, factProblems, schemaProblems, summarize, table} from './free-ai-eval-metrics.mjs';

const MODELS = {small: SMALL, strong: STRONG};
const keychain = name => { try { return execFileSync('security', ['find-generic-password', '-a', 'job-pilotto', '-s', name, '-w'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim(); } catch { return ''; } };

// The REST backend: Cloudflare's OpenAI-compatible chat route for one model. -> the answer in Workers AI's chat shape.
export const rest = ({account, token, fetcher = fetch}) => async (model, input) => {
  const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1/chat/completions`, {method: 'POST',
    headers: {'content-type': 'application/json', authorization: `Bearer ${token}`}, body: JSON.stringify({model, ...input})});
  if (!response.ok) throw new Error(`Workers AI ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return response.json();
};

// Runs every case on one model. `run(model, input)` is the backend. Never throws on one bad answer: it is a row that failed.
export async function evaluate(cases, model, run, now = () => Date.now()) {
  const results = [];
  for (const item of cases) {
    const started = now();
    const row = {id: item.id, baseline: item.baseline, ...(item.expect ? {right: false} : {}), valid: false, schemaOk: false, score: NaN, usage: {}, ms: NaN};
    try {
      const message = fromWorkersAi(await run(model, await toWorkersAi(item.params, async () => { throw new Error('PDF cases need the site route'); })), model);
      row.usage = message.usage; row.ms = now() - started;
      const data = JSON.parse(message.content[0].text);
      row.valid = true;
      const schema = item.params.output_config?.format?.schema;
      row.schemaOk = !schema || schemaProblems(data, schema).length === 0;
      row.score = Number(data.score);
      if (item.expect) { row.problems = item.expect.paths || item.expect.has ? factProblems(data, item.expect) : answerProblems(data, item.expect); row.right = row.schemaOk && !row.problems.length; }
    } catch (error) { row.error = error.message; }
    results.push(row);
  }
  return results;
}

// The REST calls draw on the same free daily allowance (10,000 neurons) as the production Free AI: a day of tuning once left every user at "busy today" (16 Oct 2026).
// So a run never uses the production account: --account names another one (a separate Cloudflare account and a Workers AI token made in it).
export const PRODUCTION_ACCOUNTS = ['f192582d62c440f34f9ca7997558cee3'];
export function guardAccount(account) {
  if (!account) throw new Error('Name the Cloudflare account to measure on with --account <id>: never the production one, whose free daily allowance the live Free AI shares.');
  if (PRODUCTION_ACCOUNTS.includes(account)) throw new Error('That is the production Cloudflare account: its free daily allowance is the live Free AI\'s. Use a separate account (--account <id>).');
  return account;
}

// A deterministic stand-in for Workers AI (the tests, and a dry run with no key): the score follows the case's baseline, a little off.
export const mock = cases => async (model, input) => {
  const item = cases.find(each => input.messages.at(-1).content.includes(each.id)) || cases[0];
  const score = Math.max(0, Math.min(100, Math.round((item.baseline ?? 50) + (model === STRONG ? 1 : 4))));
  return {choices: [{message: {content: JSON.stringify({score, tier: 'B', components: {role_fit: score, location: score, compensation: null, growth: null, risk: 30},
    basis: {salary_stated: false, level_stated: true}, reason: 'mock', strengths: [], gaps: [], confidence: 'medium'})}, finish_reason: 'stop'}],
  usage: {prompt_tokens: 1500, completion_tokens: 200}};
};

async function main(argv) {
  const option = name => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  const cases = JSON.parse(fs.readFileSync(option('cases') || (() => { throw new Error('--cases <file> is required'); })(), 'utf8'));
  const names = (option('models') || 'small').split(',').map(name => MODELS[name] || name);
  let run;
  if ((option('backend') || 'rest') === 'mock') run = mock(cases);
  else {
    const token = process.env.CF_API_TOKEN || keychain('job-pilotto.cloudflare.workers_ai_token');
    const account = guardAccount(option('account'));
    if (!token) throw new Error('No Workers AI token: set CF_API_TOKEN or the Keychain item job-pilotto.cloudflare.workers_ai_token (one made in the --account account), or use --backend mock.');
    run = rest({account, token});
  }
  const rows = [], usd = {};
  for (const model of names) {
    const results = await evaluate(cases, model, run);
    const row = summarize(model, results);
    rows.push(row); usd[model] = costUsd(model, {input_tokens: row.tokensIn, output_tokens: row.tokensOut});
    for (const failed of results.filter(r => r.error)) console.error(`${model} ${failed.id}: ${failed.error}`);
  }
  const text = `${table(rows, usd)}\n\n${cases.length} cases per model. ${cases.some(c => c.expect) ? 'A case is right when every field matches what the case expects.' : `Baseline: ${cases.some(c => c.baseline != null) ? 'the cases\' designed scores (not Claude\'s)' : 'none (rank columns are n/a)'}.`}\n`;
  if (option('out')) fs.writeFileSync(option('out'), text);
  process.stdout.write(text);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exit(1); });
