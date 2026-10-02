// Label meanings served to installs (src/aliases.js): who may add them, who gets them, how the canary judges them.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {bucketOf} from '../../extension/recipe-schema.js';
import {aliases, evaluateAliases, pack} from '../src/aliases.js';
import {controls, installToken} from '../src/recipes.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0004_recipes.sql', '0005_lab.sql', '0006_exposure.sql', '0008_guard.sql', '0009_knowledge.sql', '0010_aliases.sql']) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const kvStore = () => { const map = new Map(); return {get: async key => map.get(key) ?? null, put: async (key, value) => { map.set(key, value); }}; };
const env = () => ({STATS: d1(), STATS_KEY: 'secret', WAITLIST: kvStore()});
const now = new Date('2026-10-02T12:00:00Z');
const owner = (e, method, body, query = '') => aliases(new Request(`https://x/api/aliases${query}`, {method, headers: {Authorization: 'Bearer secret'}, body: body ? JSON.stringify(body) : undefined}), e, now);
const tokenOf = async (e, install) => (await (await installToken(new Request('https://x/api/install-token', {method: 'POST', headers: {'CF-Connecting-IP': '203.0.113.5'}, body: JSON.stringify({install})}), e, now)).json()).token;
const serve = async (e, install) => pack(new Request('https://x/api/packs/aliases', {headers: {'X-Install-Id': install, Authorization: `Bearer ${await tokenOf(e, install)}`}}), e, now);

test('only the owner adds meanings; invalid ones are refused; a sensitive field cannot go live without approval', async () => {
  const e = env();
  assert.equal((await aliases(new Request('https://x/api/aliases'), e, now)).status, 404);
  assert.equal((await aliases(new Request('https://x/api/aliases', {method: 'PUT', headers: {Authorization: 'Bearer wrong'}, body: '{}'}), e, now)).status, 404);
  const res = await (await owner(e, 'PUT', {status: 'verified', items: [{key: 'email', phrase: 'Courriel'}, {key: 'salary', phrase: 'pay'}, {key: 'birth_date', phrase: 'jour de naissance'}, {key: 'email', phrase: 'I agree to terms'}]})).json();
  assert.deepEqual([res.stored, res.refused], [1, ['unknown field', 'sensitive field needs approved: true', 'not a profile question']]);
  const approved = await (await owner(e, 'PUT', {status: 'canary', rollout: 10, approved: true, items: [{key: 'birth_date', phrase: 'jour de naissance'}]})).json();
  assert.equal(approved.stored, 1);
  const candidate = await (await owner(e, 'PUT', {items: [{key: 'birth_date', phrase: 'née le'}]})).json();   // a candidate needs no approval, it is not served
  assert.equal(candidate.stored, 1);
});

test('installs with a token get only running aliases at their own canary share; others are refused', async () => {
  const e = env();
  await owner(e, 'PUT', {status: 'verified', items: [{key: 'email', phrase: 'courriel'}]});
  await owner(e, 'PUT', {status: 'candidate', items: [{key: 'location', phrase: 'ville de résidence'}]});
  const install = 'install-alias-0001';
  await owner(e, 'PUT', {status: 'canary', rollout: bucketOf(install) + 1, items: [{key: 'website', phrase: 'site personnel'}]});   // just inside this install's bucket
  const other = 'install-alias-0002';
  await owner(e, 'PUT', {status: 'canary', rollout: bucketOf(other), items: [{key: 'github', phrase: 'profil github'}]});          // just outside the other's
  assert.deepEqual((await (await serve(e, install)).json()).aliases.map(a => a.phrase).sort(), ['courriel', 'profil github', 'site personnel'].filter(p => p !== 'profil github' || bucketOf(install) < bucketOf(other)).sort());
  const forOther = (await (await serve(e, other)).json()).aliases.map(a => a.phrase);
  assert.ok(forOther.includes('courriel') && !forOther.includes('profil github') && !forOther.includes('ville de résidence'));
  assert.equal((await pack(new Request('https://x/api/packs/aliases'), e, now)).status, 401);
  assert.equal((await pack(new Request('https://x/api/packs/aliases', {headers: {'X-Install-Id': install, Authorization: 'Bearer nope'}}), e, now)).status, 401);
});

test('an install can fetch the pack only so many times a day', async () => {
  const e = env();
  const install = 'install-alias-0003', headers = {'X-Install-Id': install, Authorization: `Bearer ${await tokenOf(e, install)}`};
  const get = () => pack(new Request('https://x/api/packs/aliases', {headers}), e, now);
  for (let i = 0; i < 24; i++) assert.equal((await get()).status, 200);
  assert.equal((await get()).status, 429);
});

test('targets: questions 3+ installs report that no alias placed yet', async () => {
  const e = env();
  const send = (install, label) => controls(new Request('https://x/api/controls', {method: 'POST', body: JSON.stringify({install, questions: [{label, kind: 'text', board: 'lever'}]})}), e, now);
  for (const install of ['install-aaaa-1111', 'install-bbbb-2222', 'install-cccc-3333']) { await send(install, 'Ort der Herkunft'); await send(install, 'Courriel professionnel'); }
  await send('install-aaaa-1111', 'asked by one only');
  await owner(e, 'PUT', {status: 'verified', items: [{key: 'email', phrase: 'courriel'}]});
  const targets = await (await owner(e, 'GET', undefined, '?targets=1')).json();
  assert.deepEqual(targets.targets.map(t => t.label), ['ort der herkunft']);   // courriel is placed already; the single report is not shown
  assert.ok(targets.keys.includes('place_of_origin') && targets.sensitive.includes('birth_date'));
});

test('how aliases fared is counted, and the canary grows what works, halts what fails, and never grows a sensitive one', async () => {
  const e = env();
  await owner(e, 'PUT', {status: 'canary', rollout: 5, items: [{key: 'email', phrase: 'courriel'}, {key: 'location', phrase: 'ville de résidence'}]});
  await owner(e, 'PUT', {status: 'canary', rollout: 5, approved: true, items: [{key: 'birth_date', phrase: 'jour de naissance'}]});
  const report = (phrase, ok, failed) => controls(new Request('https://x/api/controls', {method: 'POST', body: JSON.stringify({install: 'install-aaaa-1111', aliasUse: [{phrase, ok, failed}]})}), e, now);
  await report('courriel', 60, 0); await report('ville de résidence', 10, 15); await report('jour de naissance', 80, 0); await report('unknown phrase', 3, 0);
  const actions = await evaluateAliases(e.STATS, now);
  assert.deepEqual(actions.map(a => [a.alias, a.action]).sort(), [['courriel', 'grown to 25%'], ['ville de résidence', 'halted']]);
  const status = Object.fromEntries(e.STATS.db.prepare('SELECT phrase, status, rollout FROM aliases').all().map(r => [r.phrase, `${r.status} ${r.rollout}`]));
  assert.deepEqual(status, {courriel: 'canary 25', 'ville de résidence': 'disabled 0', 'jour de naissance': 'canary 5'});
});
