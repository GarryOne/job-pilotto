#!/usr/bin/env node
// The Free AI quality table (spec docs/superpowers/specs/2026-10-16-free-workers-ai.md "Quality"): runs Anthropic-shaped cases through the site's own
// translation (site/src/free-ai-translate.js) on Workers AI models and prints a markdown table: valid JSON, schema, rank against Claude's scores, cost.
//   node tools/free-ai-eval.mjs --cases <cases.json> [--models small,strong] [--backend rest|mock] [--out table.md]
// Cases (made by tools/free-ai-cases.py, fictional data only): [{id, action, params: <Anthropic request>, baseline?: <Claude's score>}].
// rest: needs a token with Account > Workers AI > Read + Edit: CF_API_TOKEN or the Keychain item job-pilotto.cloudflare.workers_ai_token; the account id is CF_ACCOUNT_ID, the Keychain item job-pilotto.cloudflare.account_id, or the token's only account. A few hundred calls cost cents.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {costUsd, SMALL, STRONG} from '../site/src/free-ai-models.js';
import {fromWorkersAi, toWorkersAi} from '../site/src/free-ai-translate.js';
import {answerProblems, schemaProblems, summarize, table} from './free-ai-eval-metrics.mjs';

const MODELS = {small: SMALL, strong: STRONG};
const keychain = name => { try { return execFileSync('security', ['find-generic-password', '-a', 'job-pilotto', '-s', name, '-w'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim(); } catch { return ''; } };

// The REST backend: Cloudflare's OpenAI-compatible chat route for one model. -> the answer in Workers AI's chat shape.
export const rest = ({account, token, fetcher = fetch}) => async (model, input) => {
  const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1/chat/completions`, {method: 'POST',
    headers: {'content-type': 'application/json', authorization: `Bearer ${token}`}, body: JSON.stringify({model, ...input})});
  if (!response.ok) throw new Error(`Workers AI ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return response.json();
};

// The token's own account (one account per token here), when no account id is given.
export async function accountOf(token, fetcher = fetch) {
  const body = await (await fetcher('https://api.cloudflare.com/client/v4/accounts', {headers: {authorization: `Bearer ${token}`}})).json().catch(() => ({}));
  return body.result?.length === 1 ? body.result[0].id : '';
}

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
      if (item.expect) { row.problems = answerProblems(data, item.expect); row.right = row.schemaOk && !row.problems.length; }
    } catch (error) { row.error = error.message; }
    results.push(row);
  }
  return results;
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
    const account = process.env.CF_ACCOUNT_ID || keychain('job-pilotto.cloudflare.account_id') || (token ? await accountOf(token) : '');
    if (!account || !token) throw new Error('No Workers AI credential: set CF_ACCOUNT_ID and CF_API_TOKEN, or the Keychain items job-pilotto.cloudflare.account_id and job-pilotto.cloudflare.workers_ai_token (or --backend mock).');
    run = rest({account, token});
  }
  const rows = [], usd = {};
  for (const model of names) {
    const results = await evaluate(cases, model, run);
    const row = summarize(model, results);
    rows.push(row); usd[model] = costUsd(model, {input_tokens: row.tokensIn, output_tokens: row.tokensOut});
    for (const failed of results.filter(r => r.error)) console.error(`${model} ${failed.id}: ${failed.error}`);
  }
  const text = `${table(rows, usd)}\n\n${cases.length} cases per model. ${cases.some(c => c.expect) ? 'A case is right when every field matches its expected answer (tools/free-ai-form-cases.mjs).' : `Baseline: ${cases.some(c => c.baseline != null) ? 'the cases\' designed scores (not Claude\'s)' : 'none (rank columns are n/a)'}.`}\n`;
  if (option('out')) fs.writeFileSync(option('out'), text);
  process.stdout.write(text);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exit(1); });
