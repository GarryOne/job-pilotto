// Fill again (owner, 18 Oct 2026: "it doesn't work... it doesn't finish the job"): one form of a night filled again from the night's own sealed copy (src/ready-again.js):
// owner only; its row queued again, the night started again with the container reading that form alone; the other forms keep their results; refused while running and
// once the form's data is gone.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {tokenFor} from '../src/guard.js';
import {ready} from '../src/ready.js';

const sql = file => readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0015_ai_calls.sql', '0021_ai_cost.sql', '0043_ai_cost_provider.sql', '0079_pro.sql', '0082_pro_trial.sql', '0083_hosted.sql', '0089_ready.sql', '0090_ready_fill_at.sql', '0091_ready_ai_stopped.sql', '0097_ready_line.sql', '0098_ready_turn.sql']) db.exec(sql(file));
  db.exec('CREATE TABLE anomalies (day TEXT, kind TEXT, who TEXT, n INTEGER, detail TEXT, PRIMARY KEY (day, kind, who))');
  db.exec('CREATE TABLE IF NOT EXISTS revoked (who TEXT PRIMARY KEY, reason TEXT, at TEXT)');
  const statement = (text, args = []) => ({bind: (...v) => statement(text, v), run: async () => { const r = db.prepare(text).run(...args); return {meta: {changes: Number(r.changes)}}; },
    all: async () => ({results: db.prepare(text).all(...args).map(r => ({...r}))}), first: async () => { const r = db.prepare(text).get(...args); return r ? {...r} : null; }, text, args});
  return {db, prepare: text => statement(text), batch: async list => { for (const item of list) await item.run(); }};
}
const r2 = () => { const m = new Map(); return {m, put: async (k, v) => { m.set(k, new Uint8Array(v)); }, get: async k => (m.has(k) ? {arrayBuffer: async () => m.get(k).buffer.slice(m.get(k).byteOffset, m.get(k).byteOffset + m.get(k).byteLength)} : null),
  head: async k => (m.has(k) ? {} : null), delete: async k => { m.delete(k); }, list: async ({prefix}) => ({objects: [...m.keys()].filter(k => k.startsWith(prefix)).map(key => ({key}))})}; };
const env = (extra = {}) => ({STATS: d1(), HOSTED_STATE: r2(), STATS_SALT: 'salt', READY_KEK: 'kek-for-tests', READY_TO_SEND: 'on', READY_OWNER: 'owner-install-1', READY_OWNER_SECRET: 'owner-secret', ...extra});
const keyOf = async install => `JPF1.${install}.${await tokenFor(install, {STATS_SALT: 'salt'}, 'ai')}`;
const at = new Date('2026-10-18T05:00:00Z');
const call = async (e, method, path, body, headers = {}) => ready(new Request(`https://x/api/ready/${path}`, {method, headers, body: body === undefined ? undefined : JSON.stringify(body)}), e, at);
const owner = async () => ({'x-ready-owner': 'owner-secret', 'x-api-key': await keyOf('owner-install-1')});
const job = (id, company) => ({id, url: `https://boards.example.com/${id}`, title: 'SRE', company, fit: 80, kit: {answers: {notice: 'two months'}}, letter: `Dear ${company}`, cv: 'JVBERi0='});
const queue = () => { const sent = []; return {sent, send: async m => { sent.push(m); }}; };
const runner = () => { const seen = []; return {seen, fetch: async request => { seen.push(new URL(request.url).pathname); return new Response('{"ok":true}', {status: 200}); }}; };
const rows = async e => Object.fromEntries((await e.STATS.prepare('SELECT job, state FROM ready_jobs').all()).results.map(row => [row.job, row.state]));

test('Fill again fills one form of a finished night again, from the night\'s own copy, and leaves the other form as it was', async () => {
  const e = env({READY_QUEUE: queue(), READY_RUNNER: runner()});
  await call(e, 'POST', 'batch', {night: '2026-10-18', readyBy: '07:30', contact: {name: 'Alex Example'}, jobs: [job('j1', 'Acme'), job('j2', 'Nordlicht')]}, await owner());
  assert.equal((await call(e, 'POST', 'run', undefined, await owner())).status, 202);
  const night = {authorization: `Bearer ${e.READY_QUEUE.sent[0].token}`};
  assert.deepEqual((await (await call(e, 'GET', 'batch', undefined, night)).json()).jobs.map(each => each.id), ['j1', 'j2'], 'the first run reads the whole night');
  for (const id of ['j1', 'j2']) await call(e, 'POST', 'result', {job: id, state: 'prepared', filled: 9, left: 0}, night);
  assert.deepEqual(await rows(e), {j1: 'prepared', j2: 'prepared'});

  const stranger = {'x-ready-owner': 'owner-secret', 'x-api-key': await keyOf('someone-else-9')};
  assert.equal((await call(e, 'POST', 'again', {job: 'j2'}, stranger)).status, 401, 'owner only');
  assert.equal((await call(e, 'GET', 'again', undefined, await owner())).status, 405);
  assert.equal((await call(e, 'POST', 'again', {job: 'nope'}, await owner())).status, 410, 'a form the server does not hold');

  const again = await call(e, 'POST', 'again', {job: 'j2'}, await owner());
  assert.equal(again.status, 202, JSON.stringify(await again.clone().json()));
  assert.ok(e.READY_RUNNER.seen.includes('/close'), 'the night\'s old container is closed: a container fills a night once');
  assert.equal(e.READY_QUEUE.sent.length, 2, 'started again');
  assert.equal(e.READY_QUEUE.sent[1].batch, e.READY_QUEUE.sent[0].batch, 'the same night, from its sealed copy');
  assert.deepEqual(await rows(e), {j1: 'prepared', j2: 'queued'}, 'the other form keeps its result');
  const second = {authorization: `Bearer ${e.READY_QUEUE.sent[1].token}`};
  const read = await (await call(e, 'GET', 'batch', undefined, second)).json();
  assert.deepEqual(read.jobs.map(each => each.id), ['j2'], 'the container fills that form alone');
  assert.equal(read.jobs[0].letter, 'Dear Nordlicht', 'with its kit and letter from the night');
  assert.equal((await call(e, 'POST', 'again', {job: 'j2'}, await owner())).status, 409, 'not the form already filling');

  await call(e, 'POST', 'result', {job: 'j2', state: 'partial', filled: 7, left: 2}, second);
  assert.deepEqual(await rows(e), {j1: 'prepared', j2: 'partial'});
  assert.equal((await e.STATS.prepare('SELECT state FROM ready_batches').first()).state, 'finished');

  await call(e, 'POST', 'done', {job: 'j1'}, await owner());
  assert.equal((await call(e, 'POST', 'again', {job: 'j1'}, await owner())).status, 410, 'a form marked Done is gone');
  assert.equal((await call(env(), 'POST', 'again', {job: 'j1'}, await owner())).status, 503, 'nothing starts without the Queue');
});
