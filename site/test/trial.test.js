// The free trial's one answer (src/trial.js): the wall, a count that cannot go down, Pro and licensed installs, and the install key's reach.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {tokenFor} from '../src/guard.js';
import {addCredit, createAccount, link} from '../src/pro.js';
import {stand, status} from '../src/trial.js';
import worker from '../src/index.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0079_pro.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0082_pro_trial.sql', import.meta.url), 'utf8'));   // the trial columns (plan, trial_started_at…)
  db.exec('CREATE TABLE revoked (who TEXT PRIMARY KEY, reason TEXT, created_at TEXT)');
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args) ?? null});
  return {db, prepare: sql => statement(sql)};
}
const kv = () => { const m = new Map(); return {m, get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }}; };
const env = (extra = {}) => ({WAITLIST: kv(), STATS_SALT: 'salt', ...extra});
const keyOf = async (install, purpose = 'ai') => `JPF1.${install}.${await tokenFor(install, {STATS_SALT: 'salt'}, purpose)}`;
const at = new Date('2026-10-16T10:00:00Z');
const ask = async (e, query = '', key, when = at, headers = {}) => status(new Request(`https://x/api/trial/status?${query}`, {headers: {'x-api-key': key ?? await keyOf('install-0001'), ...headers}}), e, when);

test('stand: the wall needs BOTH 20 applications and 60 days', () => {
  assert.equal(stand({applied: 25, first: '2026-10-10T00:00:00Z', now: at}).ended, false);   // many applications, early days
  assert.equal(stand({applied: 3, first: '2026-06-01T00:00:00Z', now: at}).ended, false);    // old, few applications
  const over = stand({applied: 20, first: '2026-08-01T00:00:00Z', now: at});
  assert.deepEqual([over.ended, over.daysLeft, over.used, over.limit], [true, 0, 20, 20]);
});

test('a bad or missing key is refused', async () => {
  assert.equal((await ask(env(), '', 'nope')).status, 401);
  assert.equal((await ask(env(), '', await keyOf('install-0001', 'recipes'))).status, 401);   // another purpose's token
});

test('the first ask starts the clock; the server keeps the highest count and earliest first run, so a lower number cannot reset the trial', async () => {
  const e = env();
  const over = await (await ask(e, 'applied=25&first=2026-08-01T00:00:00Z')).json();
  assert.equal(over.ended, true);
  const patched = await (await ask(e, 'applied=0&first=2026-10-16T00:00:00Z')).json();
  assert.deepEqual([patched.ended, patched.used], [true, 25]);
  const fresh = await (await ask(env(), '')).json();
  assert.deepEqual([fresh.ended, fresh.daysLeft, fresh.used], [false, 60, 0]);
});

test('a Pro install is never over', async () => {
  const e = env({PRO_PLAN: 'test', STATS: d1()});
  const old = '?applied=30&first=2026-01-01T00:00:00Z';
  assert.equal((await (await ask(e, old.slice(1))).json()).ended, true);
  const account = await createAccount(e, 'a@example.com', at);
  await addCredit(e, account, 1e6, 'purchase', 't', at);
  assert.equal((await link(e, account, 'install-0001', at)).ok, true);
  const body = await (await ask(e, old.slice(1))).json();
  assert.deepEqual([body.pro, body.ended], [true, false]);
});

// Every route that takes an `ai` token, and every one that must not (the install key placed in a repo secret).
test('the JPF1 key reaches only the AI route, the trial status and the Pro routes; the data APIs refuse it', async () => {
  const e = env({STATS: d1()});
  const key = await keyOf('install-0001');
  const call = (path, init = {}) => worker.fetch(new Request(`https://x${path}`, {...init, headers: {'x-api-key': key, authorization: `Bearer ${key.split('.')[2]}`, 'content-type': 'application/json', ...init.headers}}), e, {waitUntil() {}});
  for (const [path, init] of [['/api/index', {}], ['/api/recipes/lookup', {method: 'POST', body: '{"install":"install-0001","fingerprints":[]}'}], ['/api/aliases', {}]]) {
    const response = await call(path, init);
    assert.ok([401, 403, 404, 405].includes(response.status), `${path} answered ${response.status}`);
  }
  assert.equal((await call('/api/trial/status')).status, 200);
});

test('the pause line is claimed once a day per install, and only by a caller that asks', async () => {
  const e = env(), old = 'applied=30&first=2026-01-01T00:00:00Z';
  assert.equal((await (await ask(e, old)).json()).notify, false);                       // no claim: nothing used up
  assert.equal((await (await ask(e, `${old}&claim=1`)).json()).notify, true);
  assert.equal((await (await ask(e, `${old}&claim=1`)).json()).notify, false);          // same day
  const tomorrow = new Date('2026-10-17T10:00:00Z');
  assert.equal((await (await ask(e, `${old}&claim=1`, undefined, tomorrow)).json()).notify, true);
  assert.equal((await (await ask(env(), `applied=1&claim=1`)).json()).notify, false);   // not over: no line
});
