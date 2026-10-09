// The /ai-cost page: the owner's view of what the product's scheduled jobs spend on AI.
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {test} from 'node:test';
import {byKey, ingest, page, read, since, spent, summarize, view} from '../src/jobcost.js';

const now = new Date('2026-10-04T12:00:00Z');
const rows = [
  {job: 'central-scout', run_id: '1', day: '2026-10-04', at: '2026-10-04T04:50:00Z', usd: 0.3, calls: 20},
  {job: 'central-scout', run_id: '2', day: '2026-10-03', at: '2026-10-03T04:50:00Z', usd: 0.1, calls: 8},
  {job: 'ui-fix', run_id: '3', day: '2026-10-03', at: '2026-10-03T10:00:00Z', usd: 0.2, calls: 1},
  {job: 'old', run_id: '4', day: '2026-08-01', at: '2026-08-01T10:00:00Z', usd: 99, calls: 1},
];

test('totals cover 30 days per job, per day and against the billed days', () => {
  const s = summarize(rows, [{day: '2026-10-03', usd: 0.6}], now);
  assert.equal(s.runs, 3);
  assert.equal(Math.round(s.total * 100), 60);
  assert.equal(Math.round(s.today * 100), 30);
  assert.deepEqual(s.jobs.map(job => job.job), ['central-scout', 'ui-fix']);
  assert.equal(s.covered, 50);   // 0.3 tracked of 0.6 billed on 3 Oct
  assert.equal(summarize(rows, [], now).covered, null);
});

test('the page names jobs, shows the groups and says when there is no billing report', () => {
  const html = page(rows.slice(0, 3), []);
  assert.match(html, /Central scout/);
  assert.match(html, /Discovery/);
  assert.match(html, /no billing report yet/);
  assert.match(page([], []), /Nothing reported yet/);
});

test('/ai-cost is owner-only and never a static page', async () => {
  const env = {STATS_KEY: 'secret'};
  assert.equal((await view(new Request('https://x.dev/ai-cost'), env)).status, 404);
  assert.equal((await view(new Request('https://x.dev/ai-cost?key=secret'), env)).status, 302);
  assert.equal(existsSync(new URL('../public/ai-cost.html', import.meta.url)), false);
});

test('ingest needs the key and a valid shape, and a retried report replaces itself', async () => {
  const stored = [];
  const env = {AI_COST_PUBLISH_KEY: 'k', STATS: {prepare: sql => ({bind: (...args) => ({sql, args})}), batch: async list => { stored.push(...list); }}};
  const put = (body, key = 'k') => ingest(new Request('https://x.dev/ai-cost/data', {method: 'PUT', headers: {Authorization: `Bearer ${key}`}, body: JSON.stringify(body)}), env);
  assert.equal((await put({runs: []}, 'wrong')).status, 404);
  assert.equal((await put({runs: []})).status, 400);
  assert.equal((await put({runs: [{job: 'Bad Job', run_id: '1', at: '2026-10-04T01:00:00Z', usd: 1}]})).status, 400);
  assert.equal((await put({runs: [{job: 'central-scout', run_id: '1', at: '2026-10-04T01:00:00Z', usd: -1}]})).status, 400);
  const ok = await put({runs: [{job: 'central-scout', run_id: '1', at: '2026-10-04T01:00:00Z', usd: 0.25, calls: 3}], billed: [{day: '2026-10-03', usd: 1.5}]});
  assert.equal(ok.status, 200);
  assert.match(stored[0].sql, /INSERT OR REPLACE INTO ai_cost_runs/);
  assert.equal(stored.length, 2);
});

test('per-key rows: stored by name, a real key is refused, and the card shows today, 7 and 30 days', async () => {
  const stored = [];
  const env = {AI_COST_PUBLISH_KEY: 'k', STATS: {prepare: sql => ({bind: (...args) => ({sql, args})}), batch: async list => { stored.push(...list); }}};
  const put = body => ingest(new Request('https://x.dev/ai-cost/data', {method: 'PUT', headers: {Authorization: 'Bearer k'}, body: JSON.stringify(body)}), env);
  assert.equal((await put({keys: [{day: '2026-10-05', key: 'sk-ant-api03-secret', usd: 1}]})).status, 400);
  assert.equal((await put({keys: [{day: '2026-10-05', key: 'job-pilotto-e2e-testing', usd: 2.5}]})).status, 200);
  assert.match(stored[0].sql, /INSERT OR REPLACE INTO ai_cost_keys/);
  const now = new Date('2026-10-07T12:00:00Z');
  const keys = byKey([{day: '2026-10-07', key: 'e2e', usd: 1}, {day: '2026-10-02', key: 'e2e', usd: 2}, {day: '2026-09-20', key: 'e2e', usd: 4}, {day: '2026-08-01', key: 'e2e', usd: 100}], now);
  assert.deepEqual(keys, [{key: 'e2e', today: 1, week: 3, month: 7, last: '2026-10-07'}]);
  assert.match(page([], [], [{day: '2026-10-07', key: 'job-pilotto-e2e-testing', usd: 1}]), /By API key[\s\S]*job-pilotto-e2e-testing/);
});

// 7 Oct 2026 (owner: "$30 a week" for e2e): CI reads a day's reported e2e spend to skip the paid judge once over budget (desktop/e2e/ai-spend.mjs).
test('a day\'s reported spend for a job prefix, with the publishing key only', async () => {
  const asked = [];
  const env = {AI_COST_PUBLISH_KEY: 'k', STATS: {prepare: sql => ({bind: (...args) => ({first: async () => { asked.push({sql, args}); return {usd: 4.123456, runs: 17}; }})})}};
  const get = (query, key = 'k') => spent(new Request(`https://x.dev/ai-cost/data${query}`, {headers: {Authorization: `Bearer ${key}`}}), env);
  assert.equal((await get('?day=2026-10-07&prefix=e2e-', 'wrong')).status, 404);
  assert.equal((await get('?day=yesterday')).status, 400);
  assert.equal((await get('?prefix=E2E%25;drop')).status, 400);
  const answer = await (await get('?day=2026-10-07&prefix=e2e-')).json();
  assert.deepEqual(answer, {day: '2026-10-07', prefix: 'e2e-', usd: 4.1235, runs: 17});
  assert.deepEqual(asked[0].args, ['2026-10-07', 'e2e-%']);
});

test('measuring starts at AI_COST_SINCE: older rows are not read, and the first tile says since when', async () => {
  assert.equal(since({AI_COST_SINCE: '2026-10-09'}), '2026-10-09');
  assert.equal(since({AI_COST_SINCE: 'soon'}), '', 'a malformed date is ignored');
  assert.equal(since({}), '');
  const bound = [];
  const env = {AI_COST_SINCE: '2099-01-01', STATS: {prepare: () => ({bind: from => { bound.push(from); return {all: async () => ({results: []})}; }})}};
  await read(env);
  assert.deepEqual(bound, ['2099-01-01', '2099-01-01', '2099-01-01'], 'runs, billed and per-key rows all start there');
  const now = new Date('2026-10-12T10:00:00Z');
  assert.match(page([], [], [], '2026-10-09', now), /Since 2026-10-09/);
  assert.match(page([], [], [], '2026-08-01', now), /Last 30 days/, 'a start older than 30 days changes nothing');
});

test('Claude and OpenAI separately and together: a run says its provider (none: Anthropic), the page shows both rows and the total', async () => {
  const mixed = [...rows.slice(0, 3), {job: 'e2e-app', run_id: '9', day: '2026-10-04', at: '2026-10-04T09:00:00Z', usd: 0.2, calls: 5, provider: 'openai'}];
  const s = summarize(mixed, [], now);
  const of = id => s.providers.find(p => p.id === id);
  assert.equal(Math.round(of('anthropic').usd * 100), 60);
  assert.equal(Math.round(of('openai').usd * 100), 20);
  assert.equal(Math.round(of('openai').today * 100), 20);
  assert.equal(Math.round((of('anthropic').usd + of('openai').usd) * 100), Math.round(s.total * 100), 'the two add up to the total');
  const html = page(mixed, [], [], '', now);
  assert.match(html, /By provider/);
  assert.match(html, /Claude \(Anthropic\)<\/td><td class="n">\$0\.30<\/td><td class="n">\$0\.60<\/td><td class="n">75%/);
  assert.match(html, /OpenAI<\/td><td class="n">\$0\.20<\/td><td class="n">\$0\.20<\/td><td class="n">25%/);
  const stored = [];
  const env = {AI_COST_PUBLISH_KEY: 'k', STATS: {prepare: sql => ({bind: (...args) => ({sql, args})}), batch: async list => { stored.push(...list); }}};
  const put = body => ingest(new Request('https://x.dev/ai-cost/data', {method: 'PUT', headers: {Authorization: 'Bearer k'}, body: JSON.stringify(body)}), env);
  assert.equal((await put({runs: [{job: 'e2e-app', run_id: '1', at: '2026-10-04T01:00:00Z', usd: 0.1, provider: 'gemini'}]})).status, 400);
  assert.equal((await put({runs: [{job: 'e2e-app', run_id: '1', at: '2026-10-04T01:00:00Z', usd: 0.1, provider: 'openai'}, {job: 'ui-fix', run_id: '2', at: '2026-10-04T01:00:00Z', usd: 0.1}]})).status, 200);
  assert.deepEqual(stored.map(row => row.args.at(-1)), ['openai', 'anthropic']);
});
