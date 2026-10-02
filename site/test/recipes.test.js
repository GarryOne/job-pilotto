// The shared recipe library (src/recipes.js): what it accepts, what it serves, and how a canary is promoted or halted.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {appliesTo, bucketOf, validateBundle, validateRecipe} from '../../extension/recipe-schema.js';
import {cleanSkeleton, controlStats, controls, evaluateCanary, recipes} from '../src/recipes.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0004_recipes.sql', import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const env = () => ({STATS: d1(), STATS_KEY: 'secret'});
const recipe = (extra = {}) => ({fingerprint: '1d2pcapx18', version: 1, operator: 'toggle', params: {onAttr: 'aria-pressed', onValue: 'true'}, ...extra});
const put = (e, body, key = 'secret') => recipes(new Request('https://x/api/recipes', {method: 'PUT', headers: {Authorization: `Bearer ${key}`}, body: JSON.stringify(body)}), e);
const get = (e, headers = {}) => recipes(new Request('https://x/api/recipes', {headers}), e);
const now = new Date('2026-10-02T12:00:00Z');

test('a recipe is data in a fixed shape; anything else is refused', () => {
  assert.equal(validateRecipe(recipe()).ok, true);
  assert.equal(validateRecipe(recipe({operator: 'run-code'})).ok, false);
  assert.equal(validateRecipe(recipe({fingerprint: 'NOT VALID'})).ok, false);
  assert.equal(validateRecipe(recipe({params: {option: 'button[type=submit]'}})).ok, false);   // never a submit control
  assert.equal(validateRecipe(recipe({params: {option: 'div > button, javascript:alert(1)'}})).ok, false);
  assert.equal(validateRecipe(recipe({params: {onAttr: 'onclick'}})).ok, false);
  assert.deepEqual(validateRecipe(recipe({params: {option: '.yesno button', evil: 'x'}, extra: 1})).recipe.params, {option: '.yesno button'});   // unknown fields dropped
  assert.equal(validateRecipe(recipe({operator: 'date', params: {order: 'dmy', sep: '.'}})).ok, true);
  assert.equal(validateRecipe(recipe({operator: 'date', params: {order: 'xyz'}})).ok, false);
});

test('the highest version of a fingerprint wins in a bundle; rollout is a share of installs, stable per install', () => {
  const list = validateBundle([recipe(), recipe({version: 3, params: {}}), recipe({fingerprint: 'zzzzzz1'}), {junk: true}]);
  assert.deepEqual(list.map(item => [item.fingerprint, item.version]), [['1d2pcapx18', 3], ['zzzzzz1', 1]]);
  assert.equal(bucketOf('install-a'), bucketOf('install-a'));
  const installs = Array.from({length: 400}, (_, i) => `install-${i}`);
  const share = installs.filter(id => appliesTo({rollout: 25}, id)).length / installs.length;
  assert.ok(share > 0.15 && share < 0.35, `about a quarter of installs, got ${share}`);
  assert.equal(installs.every(id => appliesTo({rollout: 100}, id)), true);
  assert.equal(installs.some(id => appliesTo({rollout: 0}, id)), false);
});

test('only the owner adds recipes; GET serves running ones with their rollout, cacheable, newest version only', async () => {
  const e = env();
  assert.equal((await put(e, {recipe: recipe()}, 'wrong')).status, 404);
  assert.equal((await put(e, {recipe: recipe({operator: 'x'})})).status, 400);
  await put(e, {recipe: recipe(), status: 'candidate'});
  assert.deepEqual((await (await get(e)).json()).recipes, []);   // a candidate is not served
  await put(e, {recipe: recipe(), status: 'canary', rollout: 5});
  await put(e, {recipe: recipe({version: 2}), status: 'verified'});
  const response = await get(e);
  const served = (await response.json()).recipes;
  assert.deepEqual(served.map(r => [r.fingerprint, r.version, r.rollout]), [['1d2pcapx18', 2, 100]]);
  assert.equal((await get(e, {'If-None-Match': response.headers.get('ETag')})).status, 304);
});

test('a control report keeps only structure, a few samples per fingerprint, and sums outcomes', async () => {
  const e = env();
  const skeleton = {t: 'div', a: {role: 'radiogroup', onclick: 'x()', 'aria-pressed': ''}, c: ['yesno', 'BAD WORD', 'ok-class'], text: 'Igor Mardari', k: [{t: 'button', a: {}, c: [], k: [], value: 'secret'}]};
  const send = body => controls(new Request('https://x/api/controls', {method: 'POST', body: JSON.stringify({install: 'install-1234', ...body})}), e, now);
  assert.equal((await send({})).status, 200);
  assert.equal((await controls(new Request('https://x/api/controls', {method: 'POST', body: '{}'}), e, now)).status, 400);
  for (let i = 0; i < 5; i++) await send({samples: [{fingerprint: 'abc123', kind: 'switch', skeleton, question: 'Remote?'}]});
  const rows = e.STATS.db.prepare('SELECT * FROM control_samples').all();
  assert.equal(rows.length, 3);
  assert.doesNotMatch(rows[0].skeleton, /Igor|secret|onclick|BAD/);
  assert.match(rows[0].skeleton, /radiogroup/);
  await send({outcomes: [{fp: 'abc123', recipe: 1, ok: 3, failed: 1}, {fp: 'bad fp', ok: 1}]});
  await send({outcomes: [{fp: 'abc123', recipe: 1, ok: 2, failed: 0}]});
  assert.deepEqual(e.STATS.db.prepare('SELECT ok, failed FROM control_outcomes').all().map(r => ({...r})), [{ok: 5, failed: 1}]);
  assert.equal(cleanSkeleton({t: 'Bad Tag'}), null);
});

test('a canary that works grows and finally becomes verified; one that fails is halted; too little evidence changes nothing', async () => {
  const e = env();
  const day = '2026-10-02';
  const record = (fp, version, ok, failed, on = day) => e.STATS.db.prepare('INSERT INTO control_outcomes (day, fingerprint, recipe, ok, failed) VALUES (?, ?, ?, ?, ?)').run(on, fp, version, ok, failed);
  await put(e, {recipe: recipe(), status: 'canary', rollout: 5}, 'secret');
  await put(e, {recipe: recipe({fingerprint: 'bad0001'}), status: 'canary', rollout: 5});
  await put(e, {recipe: recipe({fingerprint: 'new0001'}), status: 'canary', rollout: 5});
  record('1d2pcapx18', 1, 58, 2);      // 3% failed over 60 attempts: grow
  record('bad0001', 1, 12, 10);        // 45% failed over 22: halt
  record('new0001', 1, 4, 0);          // too few attempts: leave
  const actions = await evaluateCanary(e.STATS, now);
  assert.deepEqual(actions.map(a => [a.recipe, a.action]).sort(), [['1d2pcapx18 v1', 'grown to 25%'], ['bad0001 v1', 'halted']]);
  const status = fp => e.STATS.db.prepare('SELECT status, rollout FROM recipes WHERE fingerprint = ?').get(fp);
  assert.deepEqual({...status('1d2pcapx18')}, {status: 'canary', rollout: 25});
  assert.deepEqual({...status('bad0001')}, {status: 'disabled', rollout: 0});
  assert.deepEqual({...status('new0001')}, {status: 'canary', rollout: 5});
  e.STATS.db.prepare("UPDATE recipes SET updated_at = '2026-10-02T00:00:00Z' WHERE fingerprint = '1d2pcapx18'").run();
  record('1d2pcapx18', 1, 100, 1, '2026-10-03');
  const later = await evaluateCanary(e.STATS, now);
  assert.deepEqual(later.map(a => a.action), ['verified']);
  assert.deepEqual({...status('1d2pcapx18')}, {status: 'verified', rollout: 100});
  assert.deepEqual((await controlStats(e.STATS, 7, now)).map(r => r.fingerprint).sort(), ['1d2pcapx18', 'bad0001', 'new0001']);
});
