// The /ai-cost page: the owner's view of what the product's scheduled jobs spend on AI.
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {test} from 'node:test';
import {RANGES, byKey, ingest, page, rangeOf, read, since, spent, summarize, view} from '../src/jobcost.js';

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
  assert.match(stored[0].sql, /INSERT INTO ai_cost_runs[^]*ON CONFLICT[^]*WHERE usd IS NOT excluded\.usd/);   // a resent run writes nothing
  assert.equal(stored.length, 2);
});

test('per-key rows: stored by name, a real key is refused, and the card shows today, 7 and 30 days', async () => {
  const stored = [];
  const env = {AI_COST_PUBLISH_KEY: 'k', STATS: {prepare: sql => ({bind: (...args) => ({sql, args})}), batch: async list => { stored.push(...list); }}};
  const put = body => ingest(new Request('https://x.dev/ai-cost/data', {method: 'PUT', headers: {Authorization: 'Bearer k'}, body: JSON.stringify(body)}), env);
  assert.equal((await put({keys: [{day: '2026-10-05', key: 'sk-ant-api03-secret', usd: 1}]})).status, 400);
  assert.equal((await put({keys: [{day: '2026-10-05', key: 'job-pilotto-e2e-testing', usd: 2.5}]})).status, 200);
  assert.match(stored[0].sql, /INSERT INTO ai_cost_keys[^]*WHERE usd IS NOT excluded\.usd/);
  const now = new Date('2026-10-07T12:00:00Z');
  const keys = byKey([{day: '2026-10-07', key: 'e2e', usd: 1}, {day: '2026-10-02', key: 'e2e', usd: 2}, {day: '2026-09-20', key: 'e2e', usd: 4}, {day: '2026-08-01', key: 'e2e', usd: 100}], now);
  assert.deepEqual(keys, [{key: 'e2e', today: 1, week: 3, month: 7, range: 7, last: '2026-10-07'}]);
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
  assert.deepEqual(await (await get('?month=2026-10&prefix=replay-refill')).json(), {month: '2026-10', prefix: 'replay-refill', usd: 4.1235, runs: 17}, 'a whole month');
  assert.deepEqual(asked.at(-1).args, ['2026-10-%', 'replay-refill%']);
  assert.match(asked.at(-1).sql, /day LIKE \?/);
  assert.equal((await get('?month=October')).status, 400);
});

test('measuring starts at AI_COST_SINCE: older rows are not read, and the first tile says since when', async () => {
  assert.equal(since({AI_COST_SINCE: '2026-10-09'}), '2026-10-09');
  assert.equal(since({AI_COST_SINCE: 'soon'}), '', 'a malformed date is ignored');
  assert.equal(since({}), '');
  const bound = [];
  const env = {AI_COST_SINCE: '2099-01-01', STATS: {prepare: () => ({bind: from => { bound.push(from); return {all: async () => ({results: []})}; }})}};
  await read(env);
  assert.deepEqual(bound, ['2099-01-01', '2099-01-01', '2099-01-01', '2099-01-01'], 'runs, billed, per-key and Free AI rows all start there');
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

// The range filter (owner, 13 Oct 2026): every range cuts the cards, providers, groups, jobs and keys by the same rule; Today and the day table never move.
test('?range= picks 6h / 24h / 7d / 30d; anything else is 30d', () => {
  assert.deepEqual(Object.keys(RANGES), ['6h', '24h', '7d', '30d']);
  assert.equal(rangeOf('6h'), '6h');
  for (const bad of [null, '', '1y', '__proto__', 'constructor']) assert.equal(rangeOf(bad), '30d');
});

test('every range counts the runs inside it by their timestamp, and Today stays today', () => {
  const at = new Date('2026-10-04T12:00:00Z');
  const runs = [
    {job: 'central-scout', run_id: 'a', day: '2026-10-04', at: '2026-10-04T10:00:00Z', usd: 1, calls: 1},   // 2 h ago
    {job: 'central-scout', run_id: 'b', day: '2026-10-04', at: '2026-10-04T03:00:00Z', usd: 2, calls: 1},   // 9 h ago
    {job: 'ui-fix', run_id: 'c', day: '2026-10-03', at: '2026-10-03T08:00:00Z', usd: 4, calls: 1},   // 28 h ago
    {job: 'ui-fix', run_id: 'd', day: '2026-09-30', at: '2026-09-30T08:00:00Z', usd: 8, calls: 1},   // 4 days ago
    {job: 'ui-fix', run_id: 'e', day: '2026-09-10', at: '2026-09-10T08:00:00Z', usd: 16, calls: 1},   // 24 days ago
  ];
  const expected = {'6h': 1, '24h': 3, '7d': 15, '30d': 31};
  for (const id of Object.keys(RANGES)) {
    const s = summarize(runs, [], at, id);
    assert.equal(s.total, expected[id], id);
    assert.equal(s.providers.reduce((sum, p) => sum + p.usd, 0), s.total, `${id}: providers add up`);
    assert.equal(s.jobs.reduce((sum, job) => sum + job.usd, 0), s.total, `${id}: jobs add up`);
    assert.equal(s.today, 3, `${id}: Today (UTC) does not follow the range`);
    assert.equal(s.days.length, 4, `${id}: the day table stays 30 days`);
    const html = page(runs, [], [], '', at, id);
    assert.match(html, new RegExp(`Last ${RANGES[id].label}`), `${id}: the cards and tables say the range`);
    assert.match(html, new RegExp(`class="filter on"[^>]*>${RANGES[id].label}<`), `${id}: the chip is marked`);
  }
});

test('keys are daily: 6h and 24h show today + yesterday and say so; Billed too', () => {
  const at = new Date('2026-10-07T12:00:00Z');
  const keyRows = [{day: '2026-10-07', key: 'a', usd: 1}, {day: '2026-10-06', key: 'a', usd: 2}, {day: '2026-10-03', key: 'a', usd: 4}, {day: '2026-10-03', key: 'b', usd: 8}];
  assert.equal(byKey(keyRows, at, '24h')[0].range, 3);
  assert.deepEqual(byKey(keyRows, at, '6h').map(k => k.key), ['a'], 'a key with nothing in the window is not listed');
  assert.equal(byKey(keyRows, at, '7d').find(k => k.key === 'a').range, 7);
  assert.equal(byKey(keyRows, at, '30d').length, 2);
  for (const id of ['6h', '24h']) assert.match(page([], [{day: '2026-10-06', usd: 1}], keyRows, '', at, id), /stored per UTC day[\s\S]*today \+ yesterday/);
  assert.doesNotMatch(page([], [], keyRows, '', at, '7d'), /stored per UTC day/);
});

// 14 Oct 2026 (owner): per API key, then per workspace. Workspace rows come as keys named `ws.<slug>` and never show in the key table.
test('the page lists the API keys first and the workspaces after, each from its own rows', () => {
  const at = new Date('2026-10-07T12:00:00Z');
  const keyRows = [{day: '2026-10-07', key: 'job-pilotto-ui-fix', usd: 1}, {day: '2026-10-07', key: 'job-pilotto-ui-verdict', usd: 2}, {day: '2026-10-07', key: 'ws.job-pilotto-self-heal', usd: 3}];
  const html = page([], [], keyRows, '', at);
  const keysAt = html.indexOf('By API key'), spacesAt = html.indexOf('By workspace'), jobsAt = html.indexOf('By job');
  assert.ok(keysAt > 0 && keysAt < spacesAt && spacesAt < jobsAt, 'API keys, then workspaces, then jobs');
  const keysPart = html.slice(keysAt, spacesAt), spacesPart = html.slice(spacesAt, jobsAt);
  assert.match(keysPart, /job-pilotto-ui-fix/);
  assert.doesNotMatch(keysPart, /ws\.|self-heal/, 'a workspace row is not a key');
  assert.match(spacesPart, /<td>job-pilotto-self-heal<\/td><td class="n">\$3\.00/);
  assert.doesNotMatch(spacesPart, /ui-fix/);
  for (const id of Object.keys(RANGES)) assert.match(page([], [], keyRows, '', at, id), /By workspace/, id);
});

// Free AI (Workers AI) is counted by the relay, not billed by Anthropic: its own section, per step, never in the jobs' total.
test('the page shows Free AI from the relay\'s log: today, per step, per install, and only Workers AI models', () => {
  const now = new Date('2026-10-16T12:00:00Z');
  const free = [{day: '2026-10-16', who: 'a1', action: 'score', model: '@cf/qwen/qwen3-30b-a3b-fp8', calls: 40, tokens_in: 60000, tokens_out: 20000, micro_usd: 9700},
    {day: '2026-10-16', who: 'b2', action: 'kit', model: '@cf/qwen/qwen3-30b-a3b-fp8', calls: 2, tokens_in: 8000, tokens_out: 4000, micro_usd: 1700},
    {day: '2026-10-15', who: 'a1', action: 'score', model: 'claude-haiku-5-5', calls: 99, tokens_in: 1, tokens_out: 1, micro_usd: 5000000}];
  const html = page([], [], [], '', now, '30d', free);
  assert.match(html, /Free AI \(Workers AI\)/);
  assert.match(html, /neurons \(\d+%\) of the free plan · \$0\.0114 · 42 calls · 2 installs/);
  assert.match(html, /<td>score<\/td><td class="n">40<\/td>/);
  assert.doesNotMatch(html, /<td class="n">99<\/td>/, 'a Claude row in the relay log is not Free AI');
  assert.match(page([], [], [], '', now, '30d', []), /No Free AI calls yet/);
});

test('Free AI section shows the day\'s neurons as a share of the free allowance', async () => {
  const {freeSection, freeSummary} = await import('../src/free-ai-cost.js');
  const now = new Date('2026-10-16T10:00:00Z');
  const summary = freeSummary([{day: '2026-10-16', who: 'a', action: 'score', model: '@cf/qwen/qwen3-30b-a3b-fp8', calls: 10, tokens_in: 1, tokens_out: 1, micro_usd: 55000}], now);
  assert.equal(summary.todayNeurons, 5000); assert.equal(summary.allowancePct, 50);
  assert.match(freeSection(summary, 'last 30 days'), /5000 of 10000 neurons \(50%\)/);
});

test('/admin/ai-cost says how many trial installs are near or at the $2 lifetime budget', async () => {
  const {freeSection, freeSummary, trialUse} = await import('../src/free-ai-cost.js');
  const store = new Map([['freeai:life:aaaa1111bbbb', String(2 * 1e6)], ['freeai:life:cccc2222dddd', String(1.7 * 1e6)], ['freeai:life:eeee3333ffff', String(0.2 * 1e6)], ['freeai:usd:2026-10-16', '5']]);
  const kv = {list: async ({prefix}) => ({keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({name}))}), get: async k => store.get(k) ?? null};
  const trial = await trialUse(kv, 2);
  assert.deepEqual([trial.installs, trial.at, trial.near], [3, 1, 1]);
  assert.match(freeSection(freeSummary([], new Date('2026-10-16T10:00:00Z')), 'last 30 days', null, trial), /Trial budget \$2 per install, for life: 1 at it, 1 near it \(80%\+\), of 3 with use/);
});

test('/admin/ai-cost shows each install\'s day and month use against its limits, and the month total against $60', async () => {
  const {freeSection, freeSummary} = await import('../src/free-ai-cost.js');
  const model = '@cf/qwen/qwen3-30b-a3b-fp8', now = new Date('2026-10-16T10:00:00Z');
  const summary = freeSummary([{day: '2026-10-16', who: 'aaaa1111', action: 'kit', model, calls: 3, tokens_in: 1, tokens_out: 1, micro_usd: 150000},
    {day: '2026-10-02', who: 'aaaa1111', action: 'kit', model, calls: 3, tokens_in: 1, tokens_out: 1, micro_usd: 1350000},
    {day: '2026-10-05', who: 'bbbb2222', action: 'tailor', model, calls: 1, tokens_in: 1, tokens_out: 1, micro_usd: 300000},
    {day: '2026-09-30', who: 'cccc3333', action: 'kit', model, calls: 1, tokens_in: 1, tokens_out: 1, micro_usd: 900000}], now);
  assert.equal(summary.monthUsd, 1.8);
  assert.deepEqual(summary.perInstall.map(row => [row.who, +row.day.toFixed(2), +row.month.toFixed(2)]), [['aaaa1111', 0.15, 1.5], ['bbbb2222', 0, 0.3]]);
  const html = freeSection(summary, 'last 30 days');
  assert.match(html, /This month \$1\.80 of \$60 \(alert at \$40\)/); assert.match(html, /aaaa1111<\/td><td class="n">\$0\.15<\/td><td class="n">50%<\/td><td class="n">\$1\.50<\/td><td class="n">50%/);
});

test('Free AI section shows the account\'s own neuron count from Cloudflare when it is known, and nothing when it is not', async () => {
  const {freeSection, freeSummary} = await import('../src/free-ai-cost.js');
  const summary = freeSummary([], new Date('2026-10-16T10:00:00Z'));
  assert.match(freeSection(summary, 'last 30 days', 11014.4), /Account today: 11014 neurons \(from Cloudflare\)/);
  assert.doesNotMatch(freeSection(summary, 'last 30 days', null), /Account today/);
  assert.doesNotMatch(freeSection(summary, 'last 30 days'), /Account today/);
});
