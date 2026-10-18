// Ready to send, the owner secret (src/ready.js ownerOf): the install id travels to the site in reports and lookups, so it opens no owner route; every owner route needs x-ready-owner too, the 10-minute link cannot be minted without it, and the night token's routes are unchanged.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {tokenFor} from '../src/guard.js';
import {ready, start} from '../src/ready.js';

const sql = file => readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0015_ai_calls.sql', '0021_ai_cost.sql', '0043_ai_cost_provider.sql', '0079_pro.sql', '0082_pro_trial.sql', '0083_hosted.sql', '0089_ready.sql', '0090_ready_fill_at.sql', '0091_ready_ai_stopped.sql', '0097_ready_line.sql', '0098_ready_turn.sql']) db.exec(sql(file));
  const statement = (text, args = []) => ({bind: (...v) => statement(text, v), run: async () => { const r = db.prepare(text).run(...args); return {meta: {changes: Number(r.changes)}}; },
    all: async () => ({results: db.prepare(text).all(...args).map(r => ({...r}))}), first: async () => { const r = db.prepare(text).get(...args); return r ? {...r} : null; }, text, args});
  return {db, prepare: text => statement(text), batch: async list => { for (const item of list) await item.run(); }};
}
const r2 = () => { const m = new Map(); return {m, put: async (k, v) => { m.set(k, new Uint8Array(v)); }, get: async k => (m.has(k) ? {arrayBuffer: async () => m.get(k).buffer.slice(m.get(k).byteOffset, m.get(k).byteOffset + m.get(k).byteLength)} : null),
  head: async k => (m.has(k) ? {} : null), delete: async k => { m.delete(k); }, list: async ({prefix}) => ({objects: [...m.keys()].filter(k => k.startsWith(prefix)).map(key => ({key}))})}; };
const runner = () => { const seen = []; return {seen, fetch: async request => { seen.push(request.url); return new Response('{}', {status: 200}); }}; };
const env = () => ({STATS: d1(), HOSTED_STATE: r2(), STATS_SALT: 'salt', READY_KEK: 'kek', READY_TO_SEND: 'on', READY_OWNER: 'owner-install-1', READY_OWNER_SECRET: 'owner-secret', READY_RUNNER: runner()});
const keyOf = async install => `JPF1.${install}.${await tokenFor(install, {STATS_SALT: 'salt'}, 'ai')}`;
const now = new Date('2026-10-18T07:00:00Z');
const call = (e, method, path, body, headers = {}, at = now) => ready(new Request(`https://www.jobpilotto.top/api/ready/${path}`, {method, headers, body: body === undefined ? undefined : JSON.stringify(body)}), e, at);
const owner = async () => ({'x-ready-owner': 'owner-secret', 'x-api-key': await keyOf('owner-install-1')});
async function morning() {
  const e = env();
  const made = await (await call(e, 'POST', 'batch', {night: '2026-10-18', jobs: [{id: 'j1', url: 'https://boards.example.com/a/1'}, {id: 'j2', url: 'https://boards.example.com/a/2'}]}, await owner())).json();
  await start(e, made.batch, now);
  return e;
}

const OWNER_ROUTES = [['POST', 'batch'], ['POST', 'run'], ['POST', 'link'], ['GET', 'state'], ['GET', 'report'], ['POST', 'done'], ['POST', 'submitted'], ['DELETE', 'data'], ['GET', 'live'], ['GET', 'handoff'], ['GET', 'held']];

test('with the install key alone (no owner secret, or a wrong one) no owner route opens, and no link is minted', async () => {
  const e = await morning(), key = await keyOf('owner-install-1');
  for (const secret of [undefined, '', 'wrong', 'owner-secre', 'Owner-secret']) {
    for (const [method, route] of OWNER_ROUTES) {
      const headers = {'x-api-key': key, ...(secret === undefined ? {} : {'x-ready-owner': secret})};
      const response = await call(e, method, `${route}?job=j1`, method === 'GET' ? undefined : {job: 'j1', night: '2026-10-18', jobs: []}, headers);
      assert.equal(response.status, 401, `${method} ${route} with secret ${JSON.stringify(secret)}`);
    }
  }
  const minted = await call(e, 'POST', 'link', {job: 'j1'}, {'x-api-key': key});
  assert.equal(minted.status, 401);
  assert.ok(!(await minted.text()).includes('ready-live'));
  assert.equal((await call(e, 'POST', 'link', {job: 'j1'}, {'x-api-key': key, 'x-ready-owner': 'owner-secret'})).status, 200);   // the control: with both it opens
});

test('the secret alone is not enough, and a site without the secret set opens nothing to anyone', async () => {
  const e = await morning();
  assert.equal((await call(e, 'GET', 'state', undefined, {'x-ready-owner': 'owner-secret'})).status, 401);   // no install key
  assert.equal((await call(e, 'GET', 'state', undefined, {'x-api-key': await keyOf('someone-else-9'), 'x-ready-owner': 'owner-secret'})).status, 401);   // another install
  const unset = {...e, READY_OWNER_SECRET: undefined};
  for (const header of ['', 'undefined']) assert.equal((await call(unset, 'GET', 'state', undefined, {'x-api-key': await keyOf('owner-install-1'), 'x-ready-owner': header})).status, 401);
});

test('the night token and the 10-minute link keep working without the owner secret (they are other credentials)', async () => {
  const e = await morning(), link = new URL((await (await call(e, 'POST', 'link', {job: 'j1'}, await owner())).json()).url), k = link.searchParams.get('k');
  assert.equal((await call(e, 'GET', `live?job=j1&k=${encodeURIComponent(k)}`)).status, 200);
  assert.equal((await call(e, 'POST', `submitted?job=j1&k=${encodeURIComponent(k)}`, {job: 'j1'})).status, 200);
});
