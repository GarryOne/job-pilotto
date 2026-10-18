// Ready to send, a night's forms in a line (src/ready-line.js; owner, 18 Oct 2026: one server, forms in a line, a bar and a live line per row, Stop per row and for the night):
// a 2nd Fill again joins the running night; the container's steps show on the row; Stop puts a form back and leaves the other filling; a night with nothing left ends
// and its token stops working, so the container cannot run on (no orphan run); a stopped form's late result is dropped.
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
const rows = async e => Object.fromEntries((await e.STATS.prepare('SELECT job, state, step, step_n FROM ready_jobs ORDER BY job').all()).results.map(row => [row.job, row.step ? `${row.state}:${row.step}:${row.step_n}` : row.state]));
const nightState = async e => (await e.STATS.prepare('SELECT state FROM ready_batches').first()).state;

// A night of three forms, filled once (j1, j2 prepared, j3 partial). -> {e, first: the first run's night header}
async function filledNight() {
  const e = env({READY_QUEUE: queue(), READY_RUNNER: runner()});
  await call(e, 'POST', 'batch', {night: '2026-10-18', readyBy: '07:30', contact: {name: 'Alex Example'}, jobs: [job('j1', 'Acme'), job('j2', 'Nordlicht'), job('j3', 'Brightline')]}, await owner());
  await call(e, 'POST', 'run', undefined, await owner());
  const first = {authorization: `Bearer ${e.READY_QUEUE.sent[0].token}`};
  for (const [id, state, left] of [['j1', 'prepared', 0], ['j2', 'prepared', 0], ['j3', 'partial', 2]]) await call(e, 'POST', 'result', {job: id, state, filled: 9, left}, first);
  return e;
}
const tokenOf = (e, i) => ({authorization: `Bearer ${e.READY_QUEUE.sent[i].token}`});

test('two forms in a line: the 2nd joins the running night, each row shows its own step, Stop on one leaves the other filling', async () => {
  const e = await filledNight();
  assert.equal((await call(e, 'POST', 'again', {job: 'j1'}, await owner())).status, 202);
  const night = tokenOf(e, 1);
  const joined = await call(e, 'POST', 'again', {job: 'j2'}, await owner());
  assert.equal(joined.status, 202);
  assert.equal((await joined.json()).joined, true, 'the running night takes it at the end of its line');
  assert.equal(e.READY_QUEUE.sent.length, 2, 'no second server for it');
  assert.equal((await call(e, 'POST', 'again', {job: 'j2'}, await owner())).status, 409, 'a form already in the line');
  assert.deepEqual((await (await call(e, 'GET', 'batch', undefined, night)).json()).jobs.map(each => `${each.id}:${each.turn}`), ['j1:1', 'j2:1'],
    'each Fill again counts its form\'s turn up: the container fills each (form, turn) once, so a stale list fills nothing');

  assert.deepEqual((await (await call(e, 'POST', 'progress', {job: 'j1', step: 'answering', n: 3}, night)).json()), {ok: true, stop: false});
  assert.deepEqual(await rows(e), {j1: 'filling:answering:3', j2: 'queued', j3: 'partial'});
  const shown = await (await call(e, 'GET', 'state', undefined, await owner())).json();
  assert.equal(shown.jobs.find(row => row.job === 'j1').step, 'answering', 'the app reads the live step');
  assert.ok(shown.jobs.find(row => row.job === 'j1').started_at, 'and when the row started filling');
  assert.equal((await call(e, 'POST', 'progress', {job: 'j1', step: 'typing secrets'}, night)).status, 400, 'fixed words only');

  assert.equal((await call(e, 'POST', 'stop', {job: 'j2'}, await owner())).status, 200);
  assert.deepEqual(await rows(e), {j1: 'filling:answering:3', j2: 'prepared', j3: 'partial'}, 'j2 is back to its earlier result; j1 goes on');
  assert.equal(await nightState(e), 'running');
  assert.deepEqual((await (await call(e, 'POST', 'progress', {job: 'j1', step: 'reading'}, night)).json()).stop, false, 'the other form is not told to stop');
  assert.deepEqual((await (await call(e, 'GET', 'batch', undefined, night)).json()).jobs.map(each => each.id), [], 'nothing left waiting in the line');

  const done = await (await call(e, 'POST', 'result', {job: 'j1', state: 'prepared', filled: 10, left: 0}, night)).json();
  assert.equal(done.stop, true, 'the last form ends the night');
  assert.equal(await nightState(e), 'finished');
});

test('Stop on the only form filling ends the night: the container\'s next call is refused, so nothing runs on, and its late result is dropped', async () => {
  const e = await filledNight();
  await call(e, 'POST', 'again', {job: 'j3'}, await owner());
  const night = tokenOf(e, 1);
  await call(e, 'POST', 'progress', {job: 'j3', step: 'filling', n: 5}, night);
  assert.equal((await call(e, 'POST', 'stop', {job: 'j3'}, await owner())).status, 200);
  assert.deepEqual(await rows(e), {j1: 'prepared', j2: 'prepared', j3: 'partial'}, 'back to how it was before the press');
  assert.equal(await nightState(e), 'finished', 'nothing left to fill: the night ends');
  assert.equal((await call(e, 'POST', 'progress', {job: 'j3', step: 'reading'}, night)).status, 401, 'the container is refused at its next step and stops');
  assert.equal((await call(e, 'POST', 'result', {job: 'j3', state: 'prepared', filled: 9, left: 0}, night)).status, 401, 'its late result changes nothing');
  assert.deepEqual(await rows(e), {j1: 'prepared', j2: 'prepared', j3: 'partial'});
  assert.equal((await call(e, 'POST', 'stop', {job: 'j3'}, await owner())).status, 404, 'nothing is filling');
});

test('the whole night\'s Stop puts back every form waiting or filling; a form with no earlier result reads stopped', async () => {
  const e = env({READY_QUEUE: queue(), READY_RUNNER: runner()});
  await call(e, 'POST', 'batch', {night: '2026-10-18', readyBy: '07:30', contact: {name: 'Alex Example'}, jobs: [job('j1', 'Acme'), job('j2', 'Nordlicht')]}, await owner());
  await call(e, 'POST', 'run', undefined, await owner());
  const night = tokenOf(e, 0);
  await call(e, 'POST', 'progress', {job: 'j1', step: 'opening'}, night);
  const stranger = {'x-ready-owner': 'owner-secret', 'x-api-key': await keyOf('someone-else-9')};
  assert.equal((await call(e, 'POST', 'stop', {}, stranger)).status, 401, 'owner only');
  const stopped = await call(e, 'POST', 'stop', {}, await owner());
  assert.deepEqual(await stopped.json(), {ok: true, stopped: 2});
  assert.deepEqual(await rows(e), {j1: 'stopped', j2: 'stopped'});
  assert.equal(await nightState(e), 'finished');
  assert.equal((await call(e, 'POST', 'progress', {job: 'j1', step: 'filling'}, night)).status, 401);
});
