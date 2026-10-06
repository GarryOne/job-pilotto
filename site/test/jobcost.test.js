// The /ai-cost page: the owner's view of what the product's scheduled jobs spend on AI.
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {test} from 'node:test';
import {byKey, ingest, page, summarize, view} from '../src/jobcost.js';

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
