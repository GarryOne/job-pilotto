// "Why fields were left empty" (src/left-empty.js): the one reason-word table, the shares, the thin-data rule, and both admin pages showing the section.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../src/index.js';
import {data as applyingData} from '../src/applying.js';
import {GROUPS, GROUP_OF, KNOWN_WORDS, leftEmpty, leftEmptySection, tally} from '../src/left-empty.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const now = new Date('2026-10-14T12:00:00Z');
const reason = (e, word, n, source = 'user', day = '2026-10-10') => e.db.prepare("INSERT INTO fill_reasons (day, board, reason, ai_family, source, n) VALUES (?, 'ashby', ?, 'claude', ?, ?)").run(day, word, source, n);
const card = (e, id, causes, {source = 'user', install = '', day = '2026-10-10'} = {}) => e.db.prepare(`INSERT INTO fill_cards (id, day, board, version, required, filled, left_n, unread, causes, kinds, seconds, source, install)
  VALUES (?, ?, 'ashby', '0.9.1', 5, 3, 2, 0, ?, '{}', 30, ?, ?)`).run(id, day, JSON.stringify(causes), source, install);

test('every reason word the apps and the fill cards can send has a group: a new word fails here, never lands in Other by silence', () => {
  assert.deepEqual(KNOWN_WORDS.filter(word => !GROUP_OF[word]), [], 'add the word to GROUP_OF in src/left-empty.js');
  assert.deepEqual(Object.keys(GROUP_OF).filter(word => !KNOWN_WORDS.includes(word)), [], 'a word in the table that nothing sends');
  assert.deepEqual([...new Set(Object.values(GROUP_OF))].filter(key => !GROUPS.some(group => group.key === key)), []);
});

test('the four groups, their counts, shares and words; an unknown word is counted under Other by name', () => {
  const result = tally({no_answer: 60, ai_declined: 20, unread: 10, page_error: 5, real_click: 3, no_option: 1, brand_new_word: 1});
  const by = key => result.groups.find(group => group.key === key);
  assert.equal(result.total, 100);
  assert.deepEqual(result.groups.map(group => [group.key, group.count, group.share]), [['answer', 80, 0.8], ['read', 15, 0.15], ['control', 4, 0.04], ['other', 1, 0.01]]);
  assert.deepEqual(by('answer').words, [{word: 'no_answer', count: 60}, {word: 'ai_declined', count: 20}]);
  assert.deepEqual(by('control').words, [{word: 'real_click', count: 3}, {word: 'no_option', count: 1}]);
  assert.deepEqual(by('other').words, [{word: 'brand_new_word', count: 1}]);
  assert.equal(tally({}).groups[0].share, null, 'no fields: no share');
});

test('real use reads the apps\' reason words and the lab reads the pool\'s cause words, never added together', async () => {
  const e = d1();
  reason(e, 'no_answer', 40); reason(e, 'real_click', 10); reason(e, 'no_answer', 99, 'pool'); reason(e, 'no_answer', 5, 'user', '2026-09-01');   // a pool row and an old row stay out
  card(e, 'u1', {no_data: 3}, {install: 'a'}); card(e, 'p1', {ai_declined: 7, real_click: 2}, {source: 'pool'});
  const real = await leftEmpty(e, now, 'real'), lab = await leftEmpty(e, now, 'lab');
  assert.deepEqual([real.total, real.groups[0].count, real.groups[2].count], [50, 40, 10]);
  assert.deepEqual([lab.total, lab.groups[0].count, lab.groups[2].count], [9, 7, 2]);
  assert.equal(lab.sample, null);
});

test('under 3 installs the real column shows counts muted with "too few to judge" and no share; the lab never does', async () => {
  const e = d1();
  reason(e, 'no_answer', 40); reason(e, 'real_click', 10); card(e, 'u1', {no_data: 1}, {install: 'a'}); card(e, 'u2', {no_data: 1}, {install: 'b'}); card(e, 'p1', {ai_declined: 7}, {source: 'pool'});
  const thin = leftEmptySection(await leftEmpty(e, now, 'real'));
  assert.match(thin, /Too few real fills to judge: 2 forms from 2 installs in 14 days \(needs 3\+ installs\)/);
  assert.doesNotMatch(thin, /\d+%/);
  assert.match(thin, /<td class="n">40<\/td>/);
  card(e, 'u3', {no_data: 1}, {install: 'c'});
  const enough = leftEmptySection(await leftEmpty(e, now, 'real'));
  assert.doesNotMatch(enough, /Too few/);
  assert.match(enough, /80%/);
  assert.doesNotMatch(leftEmptySection(await leftEmpty(e, now, 'lab')), /Too few/);
});

test('both admin pages show the section: Real Form Filling its real-use column, Lab Form Filling the pool column', async () => {
  const env = {STATS: d1(), STATS_KEY: 'k3y', STATS_SALT: 'salt', WAITLIST: {get: async () => null, put: async () => {}, list: async () => ({keys: []})}, ASSETS: {fetch: () => new Response('asset')}};
  const today = new Date().toISOString().slice(0, 10);
  reason(env.STATS, 'no_answer', 40, 'user', today); card(env.STATS, 'p1', {ai_declined: 7}, {source: 'pool', day: today});
  const html = await (await worker.fetch(new Request('https://www.jobpilotto.top/admin/real-form-filling', {headers: {Cookie: 'jp_stats=k3y'}}), env, {})).text();
  assert.match(html, /Why fields were left empty/);
  assert.match(html, /no_answer <span class="muted">40<\/span>/);
  assert.doesNotMatch(html, /ai_declined/, 'the pool never shows on the real page');
  const lab = await applyingData(env.STATS, new Date());
  assert.match(lab.leftEmpty, /Why fields were left empty/);
  assert.match(lab.leftEmpty, /ai_declined <span class="muted">7<\/span>/);
  assert.doesNotMatch(lab.leftEmpty, /no_answer <span/, 'real use never shows on the lab page');
  assert.doesNotMatch(lab.leftEmpty, /<section class="card">/, 'the lab page boxes its own sections');
});
