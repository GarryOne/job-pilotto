// The daily product brief's numbers (src/signals.js): key only, counts only (no emails, no problem samples).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../src/index.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0001_stats.sql', '0002_telemetry.sql', '0003_feedback.sql']) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const kv = {get: async () => null, put: async () => {}, list: async () => ({keys: [{name: 'signup:someone@example.com', metadata: {at: new Date().toISOString(), role: 'SRE'}}]})};
const env = () => ({STATS: d1(), STATS_KEY: 'k3y', WAITLIST: kv, ASSETS: {fetch: () => new Response('asset')}});
const get = (e, headers = {}) => worker.fetch(new Request('https://www.jobpilotto.workers.dev/api/signals?days=7', {headers}), e, {});

test('without the key: not found', async () => {
  assert.equal((await get(env())).status, 404);
});

test('with the key: website, app and waitlist counts, never an email or a problem sample', async () => {
  const e = env();
  const send = events => worker.fetch(new Request('https://www.jobpilotto.workers.dev/report/telemetry',
    {method: 'POST', body: JSON.stringify({events})}), e, {});
  await send([{kind: 'crash', install: 'install-aaaa', version: '0.4.1', platform: 'darwin', at: new Date().toISOString(),
    where: 'window', type: 'TypeError', message: 'boom'}]);
  const response = await get(e, {Authorization: 'Bearer k3y'});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.days, 7);
  assert.equal(body.waitlist.total, 1);
  assert.equal(body.app.rows.length, 1);
  assert.ok(!('sample' in body.app.rows[0]));
  assert.ok('visits' in body.website && 'downloads' in body.website);
  assert.doesNotMatch(JSON.stringify(body), /someone@example\.com/);
});
