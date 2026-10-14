// Form Learning's "Learning loop: best case (parked)" (src/best-case.js): lost to controls, the part a recipe can express, their product, on fixture pool cards; and where the page puts it.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../src/index.js';
import {bestCase, bestCaseSection} from '../src/best-case.js';
import {GROUP_OF, RECIPE_EXPRESSIBLE, leftEmpty} from '../src/left-empty.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const now = new Date('2026-10-14T12:00:00Z');
const pool = (e, id, causes, required, day = '2026-10-10') => { const left = Object.values(causes).reduce((a, b) => a + b, 0);
  e.db.prepare("INSERT INTO fill_cards (id, day, board, version, required, filled, left_n, unread, causes, kinds, seconds, source, install) VALUES (?, ?, 'ashby', '0.9.1', ?, ?, ?, 0, ?, '{}', 30, 'pool', '')").run(id, day, required, required - left, left, JSON.stringify(causes)); };

test('only reason words the control group holds can be expressed by a recipe: the list is fixed, next to GROUP_OF', () => {
  assert.deepEqual(RECIPE_EXPRESSIBLE.filter(word => GROUP_OF[word] !== 'control'), [], 'an expressible word is a control word');
  assert.deepEqual(RECIPE_EXPRESSIBLE, ['no_option']);
});

test('lost to controls, of which expressible, and the best case: shares and fields a week, from the pool\'s 14 days', async () => {
  const e = d1();
  pool(e, 'p1', {ai_declined: 466, real_click: 39, no_option: 10}, 1264);   // 49 of 1264 lost to controls, 10 of them a recipe could express
  pool(e, 'old', {no_option: 99}, 100, '2026-09-01');   // outside the 14 days
  const best = bestCase(await leftEmpty(e, now, 'lab'));
  assert.deepEqual([best.required, best.control, best.expressible], [1264, 49, 10]);
  assert.equal(Math.round(best.lost * 1000) / 10, 3.9);
  assert.equal(Math.round(best.expressibleShare * 100), 20);
  assert.equal(Math.round(best.recovered * 1000) / 10, 0.8);
  assert.equal(best.perWeek, 5, '10 fields in 14 days is 5 a week');
});

test('the section is labelled an estimate, says it is parked, and names the discussion', async () => {
  const e = d1(); pool(e, 'p1', {real_click: 4, no_option: 6}, 100);
  const html = bestCaseSection(await leftEmpty(e, now, 'lab'));
  for (const text of ['Learning loop: best case (parked)', 'estimate', 'Discussion #803', 'Lost to controls', 'a learned fix can express', 'Best case recovered', '10%', '60%', '6%']) assert.ok(html.includes(text), text);
  assert.equal(bestCaseSection(null), '');
});

test('Form Learning shows it above the Recipe funnel, and Real Form Filling does not', async () => {
  const env = {STATS: d1(), STATS_KEY: 'k3y', STATS_SALT: 'salt', WAITLIST: {get: async () => null, put: async () => {}, list: async () => ({keys: []})}, ASSETS: {fetch: () => new Response('asset')}};
  pool(env.STATS, 'p1', {no_option: 3, real_click: 2}, 100, new Date().toISOString().slice(0, 10));
  const get = async path => (await worker.fetch(new Request(`https://www.jobpilotto.top${path}`, {headers: {Cookie: 'jp_stats=k3y'}}), env, {})).text();
  const learning = await get('/admin/form-learning'), real = await get('/admin/real-form-filling');
  assert.ok(learning.includes('Learning loop: best case (parked)'));
  assert.ok(learning.indexOf('Learning loop: best case (parked)') < learning.indexOf('Recipe funnel'), 'above the funnel');
  assert.ok(!real.includes('best case'));
});
