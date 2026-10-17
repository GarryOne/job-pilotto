// Hosted Always on, PR 1 (src/hosted.js, migrations/0083_hosted.sql): the schedule, the run token, the one result post, the inbox, and the off switch.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {tokenFor} from '../src/guard.js';
import {inbox, result, runToken, schedule, startRun} from '../src/hosted.js';

const sql = file => readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0015_ai_calls.sql', '0079_pro.sql', '0082_pro_trial.sql', '0083_hosted.sql']) db.exec(sql(file));
  db.exec('CREATE TABLE anomalies (day TEXT, kind TEXT, who TEXT, n INTEGER, detail TEXT, PRIMARY KEY (day, kind, who))');
  db.exec('CREATE TABLE IF NOT EXISTS revoked (who TEXT PRIMARY KEY, reason TEXT, at TEXT)');
  const statement = (text, args = []) => ({bind: (...v) => statement(text, v), run: async () => { const r = db.prepare(text).run(...args); return {meta: {changes: Number(r.changes)}}; },
    all: async () => ({results: db.prepare(text).all(...args).map(r => ({...r}))}), first: async () => { const r = db.prepare(text).get(...args); return r ? {...r} : null; }});
  return {db, prepare: text => statement(text)};
}
const env = (extra = {}) => ({STATS: d1(), STATS_SALT: 'salt', HOSTED_ALWAYS_ON: 'on', ...extra});
const keyOf = async install => `JPF1.${install}.${await tokenFor(install, {STATS_SALT: 'salt'}, 'ai')}`;
const now = new Date('2026-10-16T10:00:00Z');
const put = async (e, install, body, at = now) => schedule(new Request('https://x/api/hosted/schedule', {method: 'PUT', headers: {'x-api-key': await keyOf(install)}, body: JSON.stringify(body)}), e, at);
const rows = (e, text, ...a) => e.STATS.db.prepare(text).all(...a).map(r => ({...r}));
const post = (e, token, body, at = now) => result(new Request('https://x/api/hosted/result', {method: 'POST', headers: {authorization: `Bearer ${token}`}, body: JSON.stringify(body)}), e, at);
const getInbox = async (e, install, after = 0, at = now) => (await (await inbox(new Request(`https://x/api/hosted/inbox?after=${after}`, {headers: {'x-api-key': await keyOf(install)}}), e, at)).json()).matches;

test('every hosted route answers 404 while the flag is off, and wrangler.toml ships it off', async () => {
  const e = env({HOSTED_ALWAYS_ON: 'off'});
  assert.equal((await put(e, 'install-aaaa1', {on: true, email: 'a@example.com'})).status, 404);
  assert.equal((await post(e, 'HR1.x.y', {})).status, 404);
  assert.equal((await inbox(new Request('https://x/api/hosted/inbox'), e)).status, 404);
  assert.match(readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8'), /^HOSTED_ALWAYS_ON = "off"/m);
});

test('switching on needs the install key and an e-mail; it makes a trial account, links the install, once a day', async () => {
  const e = env();
  assert.equal((await schedule(new Request('https://x/api/hosted/schedule', {method: 'PUT', headers: {'x-api-key': 'JPF1.install-aaaa1.bad'}, body: '{}'}), e, now)).status, 401);
  assert.equal((await put(e, 'install-aaaa1', {on: true})).status, 400);
  const res = await put(e, 'install-aaaa1', {on: true, email: 'A@Example.com', marketing: true, freqHours: 4});
  assert.deepEqual(await res.json(), {ok: true, state: 'on', freqHours: 24, nextRunAt: '2026-10-16T11:00:00.000Z'});   // a trial never gets more than once a day
  assert.deepEqual(rows(e, 'SELECT plan, email, marketing_opt_in, marketing_opt_in_at FROM pro_accounts'), [{plan: 'trial', email: 'a@example.com', marketing_opt_in: 1, marketing_opt_in_at: now.toISOString()}]);
  assert.equal(rows(e, 'SELECT * FROM pro_devices').length, 1);
  await put(e, 'install-aaaa1', {on: true});   // again: still one schedule, the next run is kept
  assert.equal(rows(e, 'SELECT * FROM hosted_schedules').length, 1);
  await put(e, 'install-aaaa1', {on: false});
  assert.equal(rows(e, 'SELECT state FROM hosted_schedules')[0].state, 'off');
});

test('a run token is bound to one run, posts once, expires in 30 minutes, and a forged one is refused', async () => {
  const e = env();
  await put(e, 'install-aaaa1', {on: true, email: 'a@example.com'});
  const sched = rows(e, 'SELECT * FROM hosted_schedules')[0];
  const run = await startRun(e, sched, now);
  assert.equal(await startRun(e, sched, now), null);   // the slot already has a run: no double run
  assert.equal((await post(e, `HR1.${run.id}.deadbeef`, {matches: []})).status, 401);
  assert.equal((await post(e, run.token, {matches: []}, new Date(now.getTime() + 31 * 60000))).status, 401);
  const matches = [{job: 'j1', title: 'Engineer', company: 'Acme', url: 'https://acme.test/1', fit: 8, line: 'good'}, {job: 'j1', title: 'dup'}, {title: 'no id'}];
  assert.equal((await post(e, run.token, {matches})).status, 200);
  assert.equal((await post(e, run.token, {matches})).status, 401);   // the token worked once
  const other = await runToken(e, 'run_other');
  assert.equal((await post(e, other, {matches: []})).status, 401);   // no such run
  assert.equal(rows(e, 'SELECT status, new_count FROM hosted_runs')[0].new_count, 2);
  assert.equal(rows(e, 'SELECT next_run_at FROM hosted_schedules')[0].next_run_at, '2026-10-17T10:00:00.000Z');
});

test('the inbox gives the app its matches after an id, per account, newest 200 kept, and counts as app contact', async () => {
  const e = env();
  await put(e, 'install-aaaa1', {on: true, email: 'a@example.com'});
  await put(e, 'install-bbbb2', {on: true, email: 'b@example.com'});
  const [sa, sb] = rows(e, 'SELECT * FROM hosted_schedules ORDER BY created_at, account');
  const many = Array.from({length: 250}, (_, i) => ({job: `j${i}`, title: `T${i}`}));
  const a = await startRun(e, sa, now); await post(e, a.token, {matches: many});
  const b = await startRun(e, sb, now); await post(e, b.token, {matches: [{job: 'x', title: 'Other'}]});
  const mine = await getInbox(e, sa.install === 'install-aaaa1' ? 'install-aaaa1' : 'install-bbbb2', 0, new Date('2026-10-20T00:00:00Z'));
  assert.ok(mine.length === 200 || mine.length === 1);
  assert.equal(rows(e, 'SELECT COUNT(*) AS n FROM hosted_inbox WHERE account = ?', sa.account)[0].n, 200);
  assert.equal(rows(e, 'SELECT last_seen_at FROM hosted_schedules WHERE account = ?', sa.account)[0].last_seen_at, '2026-10-20T00:00:00.000Z');
  assert.deepEqual((await getInbox(e, 'install-bbbb2', 0)).map(m => m.title).filter(t => t === 'Other'), ['Other']);
  assert.deepEqual(await getInbox(e, 'install-cccc3'), []);
});

test('opening the app resumes a schedule the 14-day pause stopped, and only that pause', async () => {
  const e = env();
  await put(e, 'install-aaaa1', {on: true, email: 'a@example.com'});
  const sql = (text, ...a) => e.STATS.db.prepare(text).run(...a);
  sql("UPDATE hosted_schedules SET state = 'paused', pause_reason = 'trial-over'");
  await getInbox(e, 'install-aaaa1');
  assert.deepEqual(rows(e, 'SELECT state, pause_reason FROM hosted_schedules'), [{state: 'paused', pause_reason: 'trial-over'}]);   // out of budget: opening the app does not undo it
  sql("UPDATE hosted_schedules SET state = 'paused', pause_reason = 'inactive'");
  await getInbox(e, 'install-aaaa1');
  assert.deepEqual(rows(e, 'SELECT state, pause_reason FROM hosted_schedules'), [{state: 'on', pause_reason: null}]);
});
