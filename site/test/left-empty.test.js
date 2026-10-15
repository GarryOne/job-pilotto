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
// A card: `required` fields, of which the causes name the left ones; filled = required - left.
const left = causes => Object.values(causes).reduce((a, b) => a + b, 0);
const card = (e, id, causes, {source = 'user', install = '', day = '2026-10-10', required = 100} = {}) => e.db.prepare(`INSERT INTO fill_cards (id, day, board, version, required, filled, left_n, unread, causes, kinds, seconds, source, install)
  VALUES (?, ?, 'ashby', '0.9.1', ?, ?, ?, 0, ?, '{}', 30, ?, ?)`).run(id, day, required, required - left(causes), left(causes), JSON.stringify(causes), source, install);

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

test('real use and the lab each read their own cards, never added together; the shares are of ALL required fields', async () => {
  const e = d1();
  card(e, 'u1', {no_data: 30, real_click: 10, unread: 10}, {install: 'a'});   // 100 required: 50 filled, 50 left
  card(e, 'p1', {ai_declined: 466, real_click: 49}, {source: 'pool', required: 1264}); card(e, 'p2', {no_data: 1}, {source: 'pool', required: 100, day: '2026-09-01'});   // an old card stays out
  const real = await leftEmpty(e, now, 'real'), lab = await leftEmpty(e, now, 'lab');
  assert.deepEqual([real.required, real.filled, real.total, real.filledShare], [100, 50, 50, 0.5]);
  assert.deepEqual(real.groups.map(group => [group.key, group.count, group.share, group.ofRequired]), [['answer', 30, 0.6, 0.3], ['read', 10, 0.2, 0.1], ['control', 10, 0.2, 0.1], ['other', 0, 0, 0]]);
  assert.deepEqual([lab.required, lab.filled, lab.total], [1264, 749, 515]);   // the pool's 14 days on 15 Oct: 1264 required, 749 filled, 515 left
  assert.equal(Math.round(lab.filledShare * 100), 59);
  assert.equal(Math.round(lab.groups.find(group => group.key === 'control').ofRequired * 100), 4, 'the lab: 49 of 1264 required fields lost to controls');
  assert.equal(lab.sample, null);
});

test('the headline reads "N required fields · X% filled · Y% no answer · Z% lost to controls · W% not read" on fixture data', async () => {
  const e = d1();
  for (const install of ['a', 'b', 'c']) card(e, `u-${install}`, {no_data: 30, real_click: 10, unread: 10}, {install});
  const html = leftEmptySection(await leftEmpty(e, now, 'real'));
  assert.match(html, /300 required fields · 50% filled · 30% left with no answer · 10% lost to controls · 10% not read/);
  assert.match(html, /<\/span>60%<\/td><td class="n"><span class="bar" aria-hidden="true"><i style="width:30%"><\/i><\/span>30%<\/td>/, 'a group\'s share of left next to its share of required');
});

test('under 3 installs the real column shows counts muted with "too few to judge" and no share; the lab never does', async () => {
  const e = d1();
  card(e, 'u1', {no_data: 40, real_click: 10}, {install: 'a'}); card(e, 'u2', {no_data: 1}, {install: 'b'}); card(e, 'p1', {ai_declined: 7}, {source: 'pool'});
  const thin = leftEmptySection(await leftEmpty(e, now, 'real'));
  assert.match(thin, /Too few real fills to judge: 2 forms from 2 installs in 14 days \(needs 3\+ installs\)/);
  assert.doesNotMatch(thin, /\d+%/, 'no share while thin, headline included');
  assert.match(thin, /<td class="n">41<\/td>/);
  card(e, 'u3', {no_data: 1}, {install: 'c'});
  const enough = leftEmptySection(await leftEmpty(e, now, 'real'));
  assert.doesNotMatch(enough, /Too few/);
  assert.match(enough, /% filled/);
  assert.doesNotMatch(leftEmptySection(await leftEmpty(e, now, 'lab')), /Too few/);
});

test('both admin pages show the section: Real Form Filling its real-use column, Lab Form Filling the pool column', async () => {
  const env = {STATS: d1(), STATS_KEY: 'k3y', STATS_SALT: 'salt', WAITLIST: {get: async () => null, put: async () => {}, list: async () => ({keys: []})}, ASSETS: {fetch: () => new Response('asset')}};
  const today = new Date().toISOString().slice(0, 10);
  card(env.STATS, 'u1', {no_answer: 40}, {install: 'a', day: today}); card(env.STATS, 'p1', {ai_declined: 7}, {source: 'pool', day: today});
  const html = await (await worker.fetch(new Request('https://www.jobpilotto.top/admin/real-form-filling', {headers: {Cookie: 'jp_stats=k3y'}}), env, {})).text();
  assert.match(html, /Why fields were left empty/);
  assert.match(html, /no_answer<span class="cnt">40<\/span>/);
  assert.doesNotMatch(html, /ai_declined/, 'the pool never shows on the real page');
  const lab = await applyingData(env.STATS, new Date());
  assert.match(lab.leftEmpty, /Why fields were left empty/);
  assert.match(lab.leftEmpty, /ai_declined<span class="cnt">7<\/span>/);
  assert.doesNotMatch(lab.leftEmpty, /no_answer <span/, 'real use never shows on the lab page');
  assert.doesNotMatch(lab.leftEmpty, /<section class="card">/, 'the lab page boxes its own sections');
});

test('every meaning word has a title and a bucket; the split reads the card counts for real use and the lab apart, with the thin rule', async () => {
  const {MEANINGS} = await import('../../extension/fill-meaning.js');
  const {MEANING_TITLE, bucketOf, splitGaps} = await import('../src/answer-gaps.js');
  assert.deepEqual(MEANINGS.filter(word => !MEANING_TITLE[word]), [], 'add the word to MEANING_TITLE in src/answer-gaps.js');
  assert.deepEqual([bucketOf('salary:proposed:gap'), bucketOf('work_permit:proposed:design'), bucketOf('legal:other:design'), bucketOf('salary:no_data:gap')], ['suggested', 'suggested', 'purpose', 'gap']);
  const split = splitGaps({'salary:proposed:gap': 3, 'legal:other:design': 5, 'salary:no_data:gap': 2, 'work_permit:ai_declined:gap': 1, 'made_up:other:gap': 9});
  assert.deepEqual(split.buckets.map(b => [b.key, b.count]), [['suggested', 3], ['purpose', 5], ['gap', 3]]);
  assert.deepEqual(split.buckets[2].meanings.map(m => [m.meaning, m.count]), [['salary', 2], ['work_permit', 1]]);
  const e = d1();
  const withGaps = (id, gaps, source, install = '') => e.db.prepare(`INSERT INTO fill_cards (id, day, board, version, required, filled, left_n, unread, causes, gaps, kinds, seconds, source, install) VALUES (?, '2026-10-10', 'ashby', '0.9.1', 5, 3, 2, 0, '{}', ?, '{}', 30, ?, ?)`).run(id, JSON.stringify(gaps), source, install);
  withGaps('u1', {'salary:proposed:gap': 4}, 'user', 'a'); withGaps('p1', {'salary:no_data:gap': 7}, 'pool');
  const real = await leftEmpty(e, now, 'real'), lab = await leftEmpty(e, now, 'lab');
  assert.deepEqual([real.gaps.total, lab.gaps.total], [4, 7]);
  assert.match(leftEmptySection(real), /What the unanswered fields were about/);
  assert.doesNotMatch(leftEmptySection(real), /\d+%/, 'one install: counts only');
  assert.match(leftEmptySection(lab), /True gap/);
});
