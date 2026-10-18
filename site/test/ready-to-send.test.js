// Ready to send, phase 1, the Worker's side (src/ready.js): only the owner reaches it, the batch is unreadable at rest, a container can report counts but never a Submit, the night's cost caps it, and the data is deleted three ways.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {tokenFor} from '../src/guard.js';
import {ready, readyToken, start, sweep} from '../src/ready.js';
import {dropKept} from '../src/ready-kept.js';

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
const r2 = () => { const m = new Map(), at = new Map(); return {m, at, put: async (k, v) => { m.set(k, new Uint8Array(v)); at.set(k, new Date()); }, get: async k => (m.has(k) ? {arrayBuffer: async () => m.get(k).buffer.slice(m.get(k).byteOffset, m.get(k).byteOffset + m.get(k).byteLength)} : null),
  head: async k => (m.has(k) ? {} : null), delete: async k => { for (const one of [k].flat()) m.delete(one); }, list: async ({prefix}) => ({objects: [...m.keys()].filter(k => k.startsWith(prefix)).map(key => ({key, uploaded: at.get(key)}))})}; };
const env = (extra = {}) => ({STATS: d1(), HOSTED_STATE: r2(), STATS_SALT: 'salt', READY_KEK: 'kek-for-tests', READY_TO_SEND: 'on', READY_OWNER: 'owner-install-1', READY_OWNER_SECRET: 'owner-secret', ...extra});
const keyOf = async install => `JPF1.${install}.${await tokenFor(install, {STATS_SALT: 'salt'}, 'ai')}`;
const now = new Date('2026-10-18T02:00:00Z');
const call = async (e, method, path, body, headers = {}) => ready(new Request(`https://x/api/ready/${path}`, {method, headers, body: body === undefined ? undefined : JSON.stringify(body)}), e, now);
const owner = async (headers = {}) => ({'x-ready-owner': 'owner-secret', 'x-api-key': await keyOf('owner-install-1'), ...headers});
const batchBody = () => ({night: '2026-10-18', readyBy: '07:30', contact: {name: 'Alex Example', email: 'alex@example.invalid'},
  jobs: [{id: 'j1', url: 'https://boards.example.com/acme/jobs/1', title: 'SRE', company: 'Acme', fit: 80, kit: {answers: {notice: 'two months secretword'}}, letter: 'Dear Acme secretletter', cv: 'JVBERi0=', letterPdf: 'JVBERi1x'},
    {id: 'j2', url: 'https://jobs.example.org/p/2', title: 'DevOps', company: 'Nordlicht', fit: 70, kit: {}, letter: '', cv: ''}]});
async function night(e = env()) {
  const made = await (await call(e, 'POST', 'batch', batchBody(), await owner())).json();
  const token = await start(e, made.batch, now);
  return {e, made, token, bearer: {authorization: `Bearer ${token}`}};
}

test('off, or any install but the owner, reaches nothing: a class check over every route', async () => {
  const subs = ['batch', 'result', 'ai', 'video', 'handoff', 'done', 'submitted', 'state', 'report', 'data', 'again', 'progress', 'stop', 'run', 'link', 'live', 'held'];
  const routed = [...readFileSync(new URL('../src/ready.js', import.meta.url), 'utf8').matchAll(/sub === '(\w+)'/g)].map(match => match[1]);
  for (const sub of routed) assert.ok(subs.includes(sub), `the route ${sub} is in this class check`);
  const off = env({READY_TO_SEND: 'off'});
  for (const sub of subs) assert.equal((await call(off, 'GET', sub)).status, 404, `${sub} off`);
  const e = env();
  const stranger = {'x-ready-owner': 'owner-secret', 'x-api-key': await keyOf('someone-else-9')};
  for (const sub of subs) for (const method of ['GET', 'POST', 'DELETE']) {
    const response = await call(e, method, sub, method === 'POST' ? {job: 'j1'} : undefined, stranger);
    assert.ok([401, 405].includes(response.status), `${method} ${sub} -> ${response.status}`);
  }
  assert.equal((await call(env({READY_OWNER: ''}), 'GET', 'state', undefined, await owner())).status, 404);   // no owner set: closed
});

test('the batch is unreadable at rest, the rows hold the host and never the address', async () => {
  const {e} = await night();
  const stored = new TextDecoder().decode([...e.HOSTED_STATE.m.values()][0]);
  for (const word of ['secretword', 'secretletter', 'alex@example', 'boards.example.com']) assert.ok(!stored.includes(word), word);
  const rows = e.STATS.db.prepare('SELECT * FROM ready_jobs ORDER BY job').all();
  assert.deepEqual(rows.map(r => r.host), ['boards.example.com', 'jobs.example.org']);
  assert.ok(!JSON.stringify(rows).includes('/acme/jobs/1'));
  assert.equal((await call(e, 'POST', 'batch', {...batchBody(), jobs: [{id: 'x', url: 'http://plain.example.com'}]}, await owner())).status, 400);   // https only
});

test('the batch is sealed with Ready to send\'s own secret: without READY_KEK it is refused, and Always on\'s HOSTED_KEK is not borrowed', async () => {
  const e = env({READY_KEK: '', HOSTED_KEK: 'always-on-key'});
  const response = await call(e, 'POST', 'batch', batchBody(), await owner());
  assert.equal(response.status, 503);
  assert.equal(e.HOSTED_STATE.m.size, 0);
});

test('a container reads the night with its token and nothing else does', async () => {
  const {e, bearer, made} = await night();
  const read = await (await call(e, 'GET', 'batch', undefined, bearer)).json();
  assert.equal(read.jobs.length, 2); assert.equal(read.contact.name, 'Alex Example'); assert.equal(read.stop, false);
  assert.equal(read.jobs[0].letterPdf, 'JVBERi1x');   // the cover letter PDF reaches the container with the CV
  assert.equal((await call(e, 'GET', 'batch', undefined, {authorization: `Bearer RR1.${made.batch}.forged`})).status, 401);
  assert.equal((await call(e, 'GET', 'batch', undefined, await owner())).status, 401);   // the owner's key is not a night token
  assert.equal((await ready(new Request('https://x/api/ready/batch', {headers: bearer}), e, new Date(now.getTime() + 4 * 3600 * 1000))).status, 401);   // expired
});

test('a container reports counts, never a Submit; prepared needs nothing left empty', async () => {
  const {e, bearer} = await night();
  const post = (state, extra = {}) => call(e, 'POST', 'result', {job: 'j1', state, filled: 9, left: 0, humanCheck: true, ms: 4000, costMicro: 3000, ...extra}, bearer);
  assert.equal((await post('submitted')).status, 400);
  assert.equal((await post('pressed-submit')).status, 400);
  assert.equal((await call(e, 'POST', 'submitted', {job: 'j1'}, bearer)).status, 401);   // the container cannot mark one
  assert.equal((await call(e, 'POST', 'done', {job: 'j1'}, bearer)).status, 401);
  assert.equal((await call(e, 'POST', 'result', {job: 'nope', state: 'wall'}, bearer)).status, 404);
  await post('prepared', {left: 2});   // the page said "prepared" but two required fields are empty: the server says partial
  assert.equal(e.STATS.db.prepare("SELECT state FROM ready_jobs WHERE job = 'j1'").get().state, 'partial');
  await post('prepared', {job: 'j2'});   // nothing left empty: prepared (a form's result is taken once: a 2nd one for j1 changes nothing)
  assert.equal(e.STATS.db.prepare("SELECT state FROM ready_jobs WHERE job = 'j2'").get().state, 'prepared');
  await post('prepared');
  assert.equal(e.STATS.db.prepare("SELECT state FROM ready_jobs WHERE job = 'j1'").get().state, 'partial');
});

test('the night stops at its cost cap and the cost is reported to /admin/ai-cost', async () => {
  const {e, bearer} = await night(env({READY_NIGHT_MAX_USD: '0.01'}));
  const first = await (await call(e, 'POST', 'result', {job: 'j1', state: 'prepared', filled: 5, left: 0, costMicro: 12000}, bearer)).json();
  assert.equal(first.stop, true);
  assert.equal((await (await call(e, 'GET', 'batch', undefined, bearer)).json()).stop, true);
  const row = e.STATS.db.prepare("SELECT * FROM ai_cost_runs WHERE job = 'ready-fill'").get();
  assert.equal(row.usd, 0.012); assert.equal(row.calls, 2);
  assert.equal(e.STATS.db.prepare('SELECT state FROM ready_batches').get().state, 'capped');
});

test('a finished night reports once; the morning measure counts prepared, reached, complete, submitted', async () => {
  const {e, bearer} = await night();
  assert.equal((await (await call(e, 'POST', 'result', {job: 'j1', state: 'prepared', filled: 9, left: 0, costMicro: 5000}, bearer)).json()).stop, false);
  assert.equal((await (await call(e, 'POST', 'result', {job: 'j2', state: 'wall', wall: 'account', costMicro: 1000}, bearer)).json()).stop, true);   // last job: finished
  assert.equal(e.STATS.db.prepare("SELECT state FROM ready_batches").get().state, 'finished');
  await call(e, 'POST', 'submitted', {job: 'j1'}, await owner());
  const report = await (await call(e, 'GET', 'report', undefined, await owner())).json();
  assert.deepEqual(report.nights[0], {night: '2026-10-18', costUsd: 0.006, queued: 2, reached: 1, complete: 1, submitted: 1});
  const state = await (await call(e, 'GET', 'state', undefined, await owner())).json();
  assert.deepEqual(state.jobs.map(j => [j.job, j.state, j.host]), [['j1', 'prepared', 'boards.example.com'], ['j2', 'wall', 'jobs.example.org']]);
  assert.ok(!JSON.stringify(state).includes('https://'));   // no address in the morning rows
});

test('deleted three ways: Done, Delete everything, and the 24 h sweep; the counts stay', async () => {
  let {e} = await night();
  await call(e, 'POST', 'done', {job: 'j1'}, await owner());
  assert.equal((await (await call(e, 'GET', 'state', undefined, await owner())).json()).jobs[0].cleared_at !== null, true);
  const after = JSON.parse(new TextDecoder().decode((await (async () => { const {open} = await import('../src/hosted-state.js'); return open(e, 'ready:owner-install-1', [...e.HOSTED_STATE.m.values()][0], 'READY_KEK'); })())));
  assert.deepEqual(after.jobs.map(j => j.id), ['j2']);   // j1's kit, letter and CV are gone from the blob
  await call(e, 'POST', 'done', {job: 'j2'}, await owner());
  assert.equal(e.HOSTED_STATE.m.size, 0);

  ({e} = await night());
  const receipt = await (await call(e, 'DELETE', 'data', undefined, await owner())).json();
  assert.equal(e.HOSTED_STATE.m.size, 0); assert.equal(receipt.receipt.jobs, 2);
  assert.equal(e.STATS.db.prepare('SELECT COUNT(*) AS n FROM ready_jobs').get().n, 2);   // counts stay

  ({e} = await night());
  assert.deepEqual(await sweep(e, new Date(now.getTime() + 23 * 3600 * 1000)), {swept: 0, purged: 0});
  assert.equal(e.HOSTED_STATE.m.size, 1);
  assert.equal((await sweep(e, new Date(now.getTime() + 25 * 3600 * 1000))).swept, 1);
  assert.equal(e.HOSTED_STATE.m.size, 0);
  assert.equal((await sweep(e, new Date(now.getTime() + 31 * 24 * 3600 * 1000))).purged, 1);   // the counts go after 30 days
});

test('a night token is bound to its batch and a replaced night is deleted', async () => {
  const {e, made} = await night();
  assert.ok((await readyToken(e, made.batch)).startsWith('RR1.'));
  assert.equal(await start(e, made.batch, now), null);   // already running: no second token
  await call(e, 'POST', 'batch', batchBody(), await owner());   // the owner pushes the same night again
  assert.equal(e.HOSTED_STATE.m.size, 1); assert.equal(e.STATS.db.prepare('SELECT COUNT(*) AS n FROM ready_batches').get().n, 1);
});

// Watch the fill (src/ready-kept.js; owner, 18 Oct 2026: a video for every form the night opens, kept on our server).
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]);
const putVideo = (e, headers, job = 'j1', secs = 42, body = WEBM, type = 'video/webm') => ready(new Request(`https://x/api/ready/video?job=${job}&secs=${secs}`, {method: 'PUT', headers: {...headers, 'content-type': type}, body}), e, now);

test('a form\'s video: put by the night, sealed at rest, read back only by the owner, flagged on its row', async () => {
  const {e, bearer} = await night();
  assert.equal((await putVideo(e, bearer)).status, 200);
  const [key] = [...e.HOSTED_STATE.m.keys()].filter(k => k.includes('/video/'));
  assert.ok(key.startsWith('ready/owner-install-1/video/'), 'under the install, so Delete everything removes it');
  assert.notDeepEqual([...e.HOSTED_STATE.m.get(key).slice(0, 4)], [...WEBM.slice(0, 4)], 'sealed, not the raw video');
  const got = await call(e, 'GET', 'video?job=j1', undefined, await owner());
  assert.equal(got.headers.get('content-type'), 'video/webm');
  assert.deepEqual(new Uint8Array(await got.arrayBuffer()), WEBM);
  assert.equal((await call(e, 'GET', 'video?job=j1', undefined, bearer)).status, 401, 'the night token never reads it back');
  assert.equal((await call(e, 'GET', 'video?job=j2', undefined, await owner())).status, 404, 'no video for that form');
  const rows = (await (await call(e, 'GET', 'state', undefined, await owner())).json()).jobs;
  assert.deepEqual(rows.map(r => [r.job, r.video]), [['j1', true], ['j2', false]]);
});

test('a video is refused when it is not a video of this night\'s job, too long or too big, or after the night', async () => {
  const {e, bearer} = await night();
  assert.equal((await putVideo(e, {})).status, 401);
  assert.equal((await putVideo(e, bearer, 'other')).status, 404, 'not a job of this night');
  assert.equal((await putVideo(e, bearer, 'j1', 181)).status, 400, 'over 3 minutes');
  assert.equal((await putVideo(e, bearer, 'j1', 0)).status, 400);
  assert.equal((await putVideo(e, bearer, 'j1', 10, WEBM, 'application/json')).status, 400);
  assert.equal((await putVideo(e, bearer, 'j1', 10, new Uint8Array(25 * 1024 * 1024 + 1))).status, 413);
  for (const job of ['j1', 'j2']) await call(e, 'POST', 'result', {job, state: 'partial', filled: 1, left: 1}, bearer);
  assert.equal((await putVideo(e, bearer)).status, 401, 'the night is over: its token is too');
});

test('a video is deleted with its job: Done, the 24 h sweep, Delete everything; never kept past 7 days', async () => {
  const {e, bearer} = await night();
  await putVideo(e, bearer, 'j1'); await putVideo(e, bearer, 'j2');
  const videos = () => [...e.HOSTED_STATE.m.keys()].filter(k => k.includes('/video/')).length;
  await call(e, 'POST', 'done', {job: 'j1'}, await owner());
  assert.equal(videos(), 1, 'Done takes that form\'s video');
  await sweep(e, new Date(now.getTime() + 25 * 3600 * 1000));
  assert.equal(videos(), 0, 'the sweep takes the rest with the batch');
  const second = await night();
  await putVideo(second.e, second.bearer, 'j1');
  await call(second.e, 'DELETE', 'data', undefined, await owner());
  assert.equal([...second.e.HOSTED_STATE.m.keys()].filter(k => k.includes('/video/')).length, 0, 'Delete everything');
  const third = await night();
  await putVideo(third.e, third.bearer, 'j1');
  const [old] = [...third.e.HOSTED_STATE.m.keys()].filter(k => k.includes('/video/'));
  third.e.HOSTED_STATE.at.set(old, new Date(now.getTime() - 8 * 86400000));
  await dropKept(third.e, 'owner-install-1', 'another-batch', [], now);
  assert.equal(third.e.HOSTED_STATE.m.has(old), false, 'older than 7 days goes on any clean-up');
});

// Open in my browser after the night's container is gone (owner, 18 Oct 2026: "Yes, sealed, 24 h max"): the night keeps each held form's hand-off sealed beside the batch;
// the owner's GET serves it even with no container (a deploy or the container's sleep drops the held tabs); it goes with the form's data and never outlives 24 h.
const HANDOFF = {url: 'https://boards.example.com/acme/apply', storage: {cookies: [{name: 'sid', value: 'cookiesecret', domain: 'boards.example.com', path: '/'}], origins: []}, sessionStorage: {step: 'two'}, snapshot: {fields: [{id: 'name', value: 'Alex fieldsecret'}], files: []}};
const putHandoff = (e, headers, job = 'j1', body = JSON.stringify(HANDOFF), type = 'application/json') => ready(new Request(`https://x/api/ready/handoff?job=${job}`, {method: 'PUT', headers: {...headers, 'content-type': type}, body}), e, now);
const handoffs = e => [...e.HOSTED_STATE.m.keys()].filter(k => k.includes('/handoff/'));

test('a held form\'s hand-off: put by the night, sealed at rest, served to the owner with no container', async () => {
  const {e, bearer} = await night();   // no READY_RUNNER: the container is gone
  assert.equal((await putHandoff(e, bearer)).status, 200);
  const [key] = handoffs(e);
  assert.ok(key.startsWith('ready/owner-install-1/handoff/'), 'under the install, so Delete everything removes it');
  const stored = new TextDecoder().decode(e.HOSTED_STATE.m.get(key));
  for (const word of ['cookiesecret', 'fieldsecret', 'boards.example.com']) assert.ok(!stored.includes(word), `${word} is never stored unsealed`);
  const got = await call(e, 'GET', 'handoff?job=j1', undefined, await owner());
  assert.equal(got.status, 200);
  assert.deepEqual(await got.json(), {ok: true, ...HANDOFF});
  assert.equal((await call(e, 'GET', 'handoff?job=j1', undefined, bearer)).status, 401, 'the night token never reads it back');
  assert.equal((await call(e, 'GET', 'handoff?job=j2', undefined, await owner())).status, 503, 'none kept: it asks the container (not wired here)');
});

test('a hand-off is refused without a page address, as another type, too big, for another job, or after the night', async () => {
  const {e, bearer} = await night();
  assert.equal((await putHandoff(e, {})).status, 401);
  assert.equal((await putHandoff(e, bearer, 'other')).status, 404);
  assert.equal((await putHandoff(e, bearer, 'j1', JSON.stringify({...HANDOFF, url: 'javascript:alert(1)'}))).status, 400);
  assert.equal((await putHandoff(e, bearer, 'j1', 'not json')).status, 400);
  assert.equal((await putHandoff(e, bearer, 'j1', JSON.stringify(HANDOFF), 'text/plain')).status, 400);
  assert.equal((await putHandoff(e, bearer, 'j1', JSON.stringify({...HANDOFF, pad: 'x'.repeat(2 * 1024 * 1024)}))).status, 413);
  for (const job of ['j1', 'j2']) await call(e, 'POST', 'result', {job, state: 'partial', filled: 1, left: 1}, bearer);
  assert.equal((await putHandoff(e, bearer)).status, 401, 'the night is over: its token is too');
  assert.equal(handoffs(e).length, 0);
});

test('a hand-off is deleted with its form: Done, the 24 h sweep, Delete everything; never kept past 24 h (seeded clock)', async () => {
  const {e, bearer} = await night();
  await putHandoff(e, bearer, 'j1'); await putHandoff(e, bearer, 'j2');
  await call(e, 'POST', 'done', {job: 'j1'}, await owner());
  assert.equal(handoffs(e).length, 1, 'Done takes that form\'s hand-off');
  assert.equal((await call(e, 'GET', 'handoff?job=j1', undefined, await owner())).status, 404, 'and nothing is served for it');
  await sweep(e, new Date(now.getTime() + 25 * 3600 * 1000));
  assert.equal(handoffs(e).length, 0, 'the sweep takes the rest with the batch');
  const second = await night();
  await putHandoff(second.e, second.bearer, 'j1');
  await call(second.e, 'DELETE', 'data', undefined, await owner());
  assert.equal(handoffs(second.e).length, 0, 'Delete everything');
  const third = await night();
  await putHandoff(third.e, third.bearer, 'j1');
  const [old] = handoffs(third.e);
  third.e.HOSTED_STATE.at.set(old, new Date(now.getTime() - 25 * 3600 * 1000));
  await dropKept(third.e, 'owner-install-1', 'another-batch', [], now);
  assert.equal(third.e.HOSTED_STATE.m.has(old), false, 'older than 24 h goes on any clean-up, whatever its batch');
});
