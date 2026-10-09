// Label meanings served to installs (src/aliases.js): who may add them, who gets them, how the canary judges them.
import {useLaterFloors} from '../src/learning-floor.js';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {bucketOf} from '../../extension/recipe-schema.js';
import {aliases, evaluateAliases, evaluateVerifiedAliases, pack, pruneLearning, storeProposals} from '../src/aliases.js';
import {controls, installToken} from '../src/recipes.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0004_recipes.sql', '0005_lab.sql', '0006_exposure.sql', '0008_guard.sql', '0009_knowledge.sql', '0010_aliases.sql', '0014_intelligence.sql', '0016_intel_signals.sql', '0023_intel_fix_days.sql', '0017_alias_proposals.sql', '0022_form_required.sql', '0044_family_counts.sql']) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
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
  const e = {...env(), LEARNING_CANARY: 'on'};   // the staged rollout, as when it is switched back on (canary-reach.js)
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

test('targets: questions 3+ installs report that no alias placed yet', async t => {
  useLaterFloors(); t.after(() => useLaterFloors(false));   // the rule with a larger user base (src/learning-floor.js)
  const e = env();
  const send = (install, label) => controls(new Request('https://x/api/controls', {method: 'POST', body: JSON.stringify({install, questions: [{label, kind: 'text', board: 'lever'}]})}), e, now);
  for (const install of ['install-aaaa-1111', 'install-bbbb-2222', 'install-cccc-3333']) { await send(install, 'Ort der Herkunft'); await send(install, 'Courriel professionnel'); }
  await send('install-aaaa-1111', 'asked by one only');
  await owner(e, 'PUT', {status: 'verified', items: [{key: 'email', phrase: 'courriel'}]});
  const targets = await (await owner(e, 'GET', undefined, '?targets=1')).json();
  assert.deepEqual(targets.targets.map(t => t.label), ['ort der herkunft']);   // courriel is placed already; the single report is not shown
  assert.ok(targets.keys.includes('place_of_origin') && targets.sensitive.includes('birth_date'));
});

test('how aliases fared is counted, and the canary grows what works (a sensitive field too: owner, 8 Oct 2026), halts what fails', async () => {
  const e = env();
  await owner(e, 'PUT', {status: 'canary', rollout: 5, items: [{key: 'email', phrase: 'courriel'}, {key: 'location', phrase: 'ville de résidence'}]});
  await owner(e, 'PUT', {status: 'canary', rollout: 5, approved: true, items: [{key: 'birth_date', phrase: 'jour de naissance'}]});
  const report = (phrase, ok, failed) => controls(new Request('https://x/api/controls', {method: 'POST', body: JSON.stringify({install: 'install-aaaa-1111', aliasUse: [{phrase, ok, failed}]})}), e, now);
  await report('courriel', 60, 0); await report('ville de résidence', 10, 15); await report('jour de naissance', 80, 0); await report('unknown phrase', 3, 0);
  const actions = await evaluateAliases(e.STATS, now);
  assert.deepEqual(actions.map(a => [a.alias, a.action]).sort(), [['courriel', 'grown to 25%'], ['jour de naissance', 'grown to 25%'], ['ville de résidence', 'halted']]);
  const status = Object.fromEntries(e.STATS.db.prepare('SELECT phrase, status, rollout FROM aliases').all().map(r => [r.phrase, `${r.status} ${r.rollout}`]));
  assert.deepEqual(status, {courriel: 'canary 25', 'ville de résidence': 'disabled 0', 'jour de naissance': 'canary 25'});
});

test('button texts of pages with no known Apply button are targets of their own; reviewed wordings rest; a button alias must look like an apply button', async () => {
  const e = {...env(), STATS: (() => { const x = d1(); x.db.exec(readFileSync(new URL('../migrations/0011_label_reviews.sql', import.meta.url), 'utf8')); return x; })()};
  const send = (install, label, kind) => controls(new Request('https://x/api/controls', {method: 'POST', body: JSON.stringify({install, questions: [{label, kind, board: 'h:0123456789'}]})}), e, now);
  for (const install of ['install-aaaa-1111', 'install-bbbb-2222', 'install-cccc-3333']) { await send(install, 'Bewerbung starten', 'button'); await send(install, 'Search jobs', 'button'); await send(install, 'Ort der Herkunft', 'text'); }
  const buttons = await (await owner(e, 'GET', undefined, '?targets=buttons')).json();
  assert.deepEqual(buttons.targets.map(t => t.label).sort(), ['bewerbung starten', 'search jobs']);
  assert.deepEqual((await (await owner(e, 'GET', undefined, '?targets=1')).json()).targets.map(t => t.label), ['ort der herkunft']);   // questions only
  const stored = await (await owner(e, 'PUT', {reviewed: [{label: 'Search jobs'}, {label: 'Ort der Herkunft'}], items: [{key: 'apply_button', phrase: 'Bewerbung starten'}, {key: 'apply_button', phrase: 'Sign in to apply'}, {key: 'apply_button', phrase: 'sehr lange bewerbung jetzt hier starten'}]})).json();
  assert.deepEqual([stored.stored, stored.refused], [1, ['not a start-applying button', 'too long for a button']]);
  assert.deepEqual((await (await owner(e, 'GET', undefined, '?targets=buttons')).json()).targets.map(t => t.label), []);   // placed, or reviewed
  assert.deepEqual((await (await owner(e, 'GET', undefined, '?targets=1')).json()).targets.map(t => t.label), []);          // reviewed
  // A button alias is served to installs like any other, and never mistaken for a profile field by the filler's matcher.
  await owner(e, 'PUT', {status: 'verified', items: [{key: 'apply_button', phrase: 'Bewerbung starten'}]});
  assert.ok((await (await serve(e, 'install-alias-0009')).json()).aliases.some(a => a.key === 'apply_button' && a.phrase === 'bewerbung starten'));
});

test('changed-answer wordings become review targets only when enough people and fills back them; the pack carries the scoring hints; a failing verified alias is rolled back', async () => {
  const e = env();
  const put = (label, filled, corrected, installs) => e.STATS.db.prepare("INSERT INTO intel_fixes (label, filled, corrected, installs, last_day) VALUES (?, ?, ?, ?, '2026-10-01')").run(label, filled, corrected, JSON.stringify(installs));
  put('notice period', 20, 10, ['a', 'b', 'c']); put('only mine', 50, 50, ['a']); put('first name', 40, 2, ['a', 'b', 'c']); put('few fills', 5, 5, ['a', 'b', 'c']);
  const res = await (await owner(e, 'GET', null, '?targets=fixes')).json();
  assert.deepEqual(res.targets.map(t => [t.label, t.corrected, t.current]), [['notice period', 10, '']]);
  e.STATS.db.prepare("INSERT INTO intel_dismiss (day, reason, bucket, n) VALUES ('2026-10-01', 'seniority', '60-79', 60)").run();
  const served = await (await serve(e, 'install-aaaa-1111')).json();
  assert.deepEqual(served.hints, [{reason: 'seniority', share: 1}]);
  await owner(e, 'PUT', {status: 'verified', items: [{key: 'email', phrase: 'Courriel'}]});
  e.STATS.db.prepare("INSERT INTO alias_outcomes (day, phrase, ok, failed) VALUES ('2026-10-01', 'courriel', 10, 30)").run();
  assert.deepEqual((await evaluateVerifiedAliases(e.STATS, now)).map(a => [a.alias, a.action]), [['courriel', 'rolled back']]);
});

test('a wording 2 different installs proposed starts as a 5% canary at once (a sensitive one at 3), and no sooner', async t => {
  useLaterFloors(); t.after(() => useLaterFloors(false));   // the rule with a larger user base (src/learning-floor.js)
  const e = env();
  const item = {key: 'first_name', phrase: 'Preferred First Name'};
  await storeProposals(e, [item, item], 'install-a-0001', now);   // the same install twice counts once
  assert.deepEqual((await e.STATS.prepare('SELECT * FROM aliases').all()).results, []);
  const second = await storeProposals(e, [item, {key: 'salary', phrase: 'pay'}, {key: 'email', phrase: 'I agree to terms'}], 'install-b-0002', now);
  assert.deepEqual(second, {stored: 1, promoted: 1});   // the unknown field and the consent wording are refused
  const row = (await e.STATS.prepare('SELECT phrase, key, status, rollout, source FROM aliases').all()).results[0];
  assert.deepEqual({...row}, {phrase: 'preferred first name', key: 'first_name', status: 'canary', rollout: 5, source: 'installs'});
  // A sensitive field needs no owner approval any more: the canary and its automatic halt guard it (only wording + field are shared).
  for (const install of ['install-a-0001', 'install-b-0002']) await storeProposals(e, [{key: 'street', phrase: 'Rue et numéro'}], install, now);
  assert.ok(!await e.STATS.prepare("SELECT status FROM aliases WHERE phrase = 'rue et numéro'").first());   // sensitive: 2 are not enough
  await storeProposals(e, [{key: 'street', phrase: 'Rue et numéro'}], 'install-c-0003', now);
  assert.equal((await e.STATS.prepare("SELECT status FROM aliases WHERE phrase = 'rue et numéro'").first()).status, 'canary');
  await storeProposals(e, [{key: 'last_name', phrase: 'Preferred First Name'}], 'install-d-0004', now);   // a running meaning is not overwritten by more votes
  assert.equal((await e.STATS.prepare('SELECT status FROM aliases').first()).status, 'canary');
});

test('POST /api/controls takes proposals from an install', async () => {
  const e = env();
  const send = install => controls(new Request('https://x/api/controls', {method: 'POST', body: JSON.stringify({install, proposals: [{key: 'linkedin', phrase: 'Your LinkedIn profile'}]})}), e, now);
  for (const install of ['install-a-0001', 'install-b-0002', 'install-c-0003']) assert.equal((await send(install)).status, 200);
  assert.equal((await e.STATS.prepare("SELECT key FROM aliases WHERE phrase = 'your linkedin profile'").first()).key, 'linkedin');
});

// Owner, 8 Oct 2026: a wrong meaning fills fields that take the value, so the fill outcome alone grows it; people correcting it by hand halt it.
test('a meaning people keep correcting by hand is halted (canary) or rolled back (verified), even when every field took its value', async () => {
  const e = env();
  await owner(e, 'PUT', {status: 'canary', rollout: 5, items: [{key: 'email', phrase: 'courriel'}]});
  await owner(e, 'PUT', {status: 'verified', items: [{key: 'linkedin', phrase: 'profil linkedin'}]});
  const fixes = (label, filled, corrected) => e.STATS.db.prepare("INSERT INTO intel_fixes (label, filled, corrected, installs, last_day) VALUES (?, ?, ?, '[]', '2026-10-01')").run(label, filled, corrected);
  fixes('votre courriel', 8, 4); fixes('profil linkedin', 20, 2);   // 4 of 8 corrected: wrong; 2 of 20: fine
  const report = (phrase, ok) => controls(new Request('https://x/api/controls', {method: 'POST', body: JSON.stringify({install: 'install-aaaa-1111', aliasUse: [{phrase, ok, failed: 0}]})}), e, now);
  await report('courriel', 60);   // every fill took it
  assert.deepEqual((await evaluateAliases(e.STATS, now)).map(a => [a.alias, a.action]), [['courriel', 'halted: corrected by hand']]);
  assert.deepEqual(await evaluateVerifiedAliases(e.STATS, now), []);
  fixes('mon profil linkedin', 6, 6);   // now 8 of 26 corrected: over 30%
  assert.deepEqual((await evaluateVerifiedAliases(e.STATS, now)).map(a => [a.alias, a.action]), [['profil linkedin', 'rolled back: corrected by hand']]);
});

test('the learning tables keep what still decides something: old outcomes, decided or stale proposals and stale votes go', async () => {
  const e = env();
  const db = e.STATS.db;
  db.exec(readFileSync(new URL('../migrations/0040_meaning_votes.sql', import.meta.url), 'utf8'));
  db.exec("CREATE TABLE IF NOT EXISTS meanings (topic TEXT, kind TEXT, wording TEXT, answer TEXT, ord INTEGER, status TEXT, rollout INTEGER, source TEXT, updated_at TEXT)");
  db.prepare("INSERT INTO meanings (topic, kind, wording, answer, status, rollout, source) VALUES ('job-region', 'exact', 'running', 'x', 'canary', 5, 'learned')").run();
  await owner(e, 'PUT', {status: 'canary', rollout: 5, items: [{key: 'email', phrase: 'courriel'}]});
  db.prepare("INSERT INTO alias_outcomes (day, phrase, ok, failed) VALUES ('2026-06-01', 'courriel', 5, 0), ('2026-09-30', 'courriel', 5, 0)").run();
  db.prepare("INSERT INTO alias_proposals (phrase, key, installs, last_day) VALUES ('courriel', 'email', '[]', '2026-10-01'), ('vieux', 'email', '[]', '2026-05-01'), ('frais', 'email', '[]', '2026-10-01')").run();
  db.prepare("INSERT INTO meaning_votes (topic, wording, answer, install, at) VALUES ('job-region', 'old', 'x', 'i1', '2026-05-01T00:00:00Z'), ('job-region', 'new', 'x', 'i1', '2026-10-01T00:00:00Z'), ('job-region', 'running', 'x', 'i1', '2026-05-01T00:00:00Z')").run();   // a running meaning's old vote stays: it keeps it on
  const removed = await pruneLearning(e.STATS, now);
  assert.deepEqual([removed.alias_outcomes, removed.alias_proposals, removed.meaning_votes], [1, 2, 1]);
  assert.deepEqual(db.prepare('SELECT phrase FROM alias_proposals').all().map(r => r.phrase), ['frais']);
});
