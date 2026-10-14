// Operator outcomes by source (src/control-outcomes.js, migration 0070): the lab (pool, replays) never counts as real use; the proposer's targets rank real misses first and carry fixed why words.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {digest} from '../src/digest.js';
import {report} from '../src/formlearning.js';
import {controls, controlStats, evaluateCanary, evaluateVerified, targets} from '../src/recipes.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const now = new Date('2026-10-12T12:00:00Z'), today = '2026-10-12';
const env = () => ({STATS: d1(), STATS_KEY: 'secret', REPLAYS_PUBLISH_KEY: 'replay-key'});
const sample = (e, fp, kind = 'toggle-group') => e.STATS.db.prepare("INSERT INTO control_samples (fingerprint, kind, skeleton, question, seen_at) VALUES (?, ?, '{\"t\":\"div\"}', 'Remote?', 'x')").run(fp, kind);
const out = (e, fp, source, ok, failed, recipe = 0, why = '') => e.STATS.db.prepare('INSERT INTO control_outcomes (day, fingerprint, recipe, source, ok, failed, why) VALUES (?, ?, ?, ?, ?, ?, ?)').run(today, fp, recipe, source, ok, failed, why);
const send = (e, body, headers = {}) => controls(new Request('https://x/api/controls', {method: 'POST', headers, body: JSON.stringify({install: 'install-1234', ...body})}), e, now);
const rows = e => e.STATS.db.prepare('SELECT fingerprint, source, ok, failed, why FROM control_outcomes ORDER BY fingerprint, source').all().map(r => ({...r}));

test('outcomes are stored per source; only the owner\'s key makes pool or replay rows; a why is a fixed word', async () => {
  const e = env();
  await send(e, {outcomes: [{fp: 'abc123', ok: 1, failed: 2, why: 'no_answer'}, {fp: 'def456', ok: 0, failed: 1, why: 'The list did not open for "Igor"'}]});
  await send(e, {outcomes: [{fp: 'abc123', ok: 0, failed: 1, why: 'no_question'}]}, {});
  await send(e, {source: 'replay', outcomes: [{fp: 'abc123', ok: 4, failed: 0}]}, {Authorization: 'Bearer replay-key'});
  await send(e, {source: 'replay', outcomes: [{fp: 'zzz999', ok: 4, failed: 4}]});   // no key: dropped
  assert.deepEqual(rows(e), [{fingerprint: 'abc123', source: 'replay', ok: 4, failed: 0, why: ''}, {fingerprint: 'abc123', source: 'user', ok: 1, failed: 3, why: 'no_question'}, {fingerprint: 'def456', source: 'user', ok: 0, failed: 1, why: ''}]);
});

test('targets rank real failures before lab ones and carry the why words', async () => {
  const e = env();
  for (const fp of ['lab0001', 'real001', 'both001']) sample(e, fp);
  out(e, 'lab0001', 'pool', 5, 30, 0, 'no_option');
  out(e, 'real001', 'user', 1, 2, 0, 'no_answer');
  out(e, 'both001', 'user', 1, 1); out(e, 'both001', 'replay', 0, 9);
  const listed = await (await targets(new Request('https://x/api/recipes/targets', {headers: {Authorization: 'Bearer secret'}}), e, now)).json();
  assert.deepEqual(listed.targets.map(t => [t.fingerprint, t.userFailed, t.labFailed]), [['real001', 2, 0], ['both001', 1, 9], ['lab0001', 0, 30]]);
  assert.deepEqual(listed.targets[0].whys, ['no_answer']);
});

test('every reader of the outcomes judges on real use only: the canary, the verified check, the owner list, the digest, the funnel', async () => {
  const e = env();
  const add = (fp, status) => e.STATS.db.prepare("INSERT INTO recipes (fingerprint, version, status, rollout, body, source, note, created_at, updated_at) VALUES (?, 1, ?, 5, '{}', 'test', '', 'x', ?)").run(fp, status, '2026-10-12T00:00:00Z');
  add('canary01', 'canary'); add('verif001', 'verified');
  for (const fp of ['canary01', 'verif001']) { out(e, fp, 'replay', 0, 100, 1); out(e, fp, 'pool', 0, 100, 1); }   // a flood of lab failures
  assert.deepEqual(await evaluateCanary(e.STATS, now), [], 'lab failures never halt a canary');
  assert.deepEqual(await evaluateVerified(e.STATS, now), [], 'lab failures never roll a verified recipe back');
  out(e, 'canary01', 'user', 60, 0, 1);
  assert.deepEqual((await evaluateCanary(e.STATS, now)).map(a => a.action), ['grown to 25%'], 'real attempts alone decide');
  assert.deepEqual((await controlStats(e.STATS, 7, now)).map(r => r.fingerprint), ['canary01']);
  const weak = (await digest(e.STATS, now)).weaknesses.filter(w => w.kind === 'widget');
  assert.deepEqual(weak, [], 'the digest names no widget from lab rows');
  const funnel = (await report(e.STATS, now)).misses;
  assert.deepEqual([funnel.user, funnel.lab], [{controls: 0, failed: 0, attempts: 60}, {controls: 2, failed: 400, attempts: 400}]);
});
