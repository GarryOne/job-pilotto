// Real-use numbers say "too few to judge" under 3 installs (src/thin-data.js): every place that turns user fill cards into a rate or a ranking, on the page and in the digest .md.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../src/index.js';
import {digest, markdown} from '../src/digest.js';
import {report} from '../src/formlearning.js';
import {page} from '../src/real-form-filling.js';
import {page as learningPage} from '../src/form-learning.js';
import {MIN_INSTALLS, sampleOf} from '../src/thin-data.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const now = new Date('2026-10-12T12:00:00Z');
// 6 user fills over 3 days from `installs` installs, plus form_exposure and fill_reasons rows (the page's per-100 numbers).
function seed(installs) {
  const db = d1();
  for (let i = 0; i < 6; i++) db.db.prepare(`INSERT INTO fill_cards (id, day, board, version, required, filled, left_n, unread, causes, kinds, submitted, by_you, seconds, install)
    VALUES (?, ?, 'ashby', '0.9.1', 10, 6, 4, 1, '{"no_data":3,"unread":1}', '{"radio":1}', 1, 1, 40, ?)`).run(`card-${i}-aaaa`, `2026-10-${10 + (i % 3)}`, `install-${i % installs}`);
  db.db.prepare("INSERT INTO form_exposure (day, board, ai_family, n, required) VALUES ('2026-10-11', 'ashby', 'claude', 6, 60)").run();
  db.db.prepare("INSERT INTO fill_reasons (day, board, reason, ai_family, n) VALUES ('2026-10-11', 'ashby', 'unread', 'claude', 6)").run();
  return db;
}
// Each place that shows a user-count rate or ranking: [name, text of the page or the digest .md that holds it, a pattern for its percentage / ranking].
const places = (html, md, learning) => {
  const part = (text, from, to) => text.slice(text.indexOf(from), to ? text.indexOf(to, text.indexOf(from)) : undefined);
  return [
    ['page: By AI family, fields left per 100', part(learning, 'By AI family, this week', 'The AI'), /<td class="n">\d+(\.\d)?<\/td><\/tr>/],
    ['page: Filled headline', part(html, 'Filled (real use)', 'Blind spots'), /\d+%/],
    ['page: Blind spots headline', part(html, 'Blind spots (real use)', 'Recipes'), /\d+(\.\d)?<\/b>|▲|▼/],
    ['page: Efficiency day by day', part(html, 'Efficiency, day by day', 'Top weaknesses'), /\d+%/],
    ['page: Top weaknesses', part(html, 'Top weaknesses', 'Required marks'), /<ol>|impact \d/],
    ['page: Real use per 100', part(html, 'Real use: what the fill missed', 'Recipe funnel'), /<td class="n">\d+(\.\d)?<\/td><td>(<span)/],
    ['digest: this week and recent', part(md, '**This week:**', '## Top weaknesses'), /\d+%/],
    ['digest: Top weaknesses', part(md, '## Top weaknesses', '## Per release'), /impact \d/],
    ['digest: Per release', part(md, '## Per release', '## Per board'), /\d+%/],
    ['digest: Per board', part(md, '## Per board', '## Day by day'), /\d+%|dropped/],
    ['digest: Day by day', part(md, '## Day by day', '\n\n>'), /\d+%/]];
};

test('under 3 installs every place says too few, with raw counts and no rate or ranking', async () => {
  const db = seed(2);
  const data = await report(db, now), md = markdown(await digest(db, now));
  assert.deepEqual([data.learning.sample.forms, data.learning.sample.installs, data.learning.sample.enough], [6, 2, false]);
  const html = page(data), learning = learningPage(data);
  assert.match(html, /Too few real fills to judge: 6 forms from 2 installs this week \(needs 3\+ installs\)/);
  assert.match(md, /Too few real fills to judge: 6 forms from 2 installs this week/);
  for (const [name, text, shown] of places(html, md, learning)) { assert.ok(text.length > 20, `${name}: section found`); assert.doesNotMatch(text, shown, name); }
});

test('with 3 installs the same places show their rates and the ranking', async () => {
  const db = seed(MIN_INSTALLS);
  const data = await report(db, now), md = markdown(await digest(db, now));
  assert.equal(data.learning.sample.enough, true);
  const html = page(data), learning = learningPage(data);
  assert.doesNotMatch(html, /Too few real fills/);
  assert.doesNotMatch(md, /Too few real fills/);
  for (const [name, text, shown] of places(html, md, learning)) assert.match(text, shown, name);
});

test('cards from before the install column are never counted as an install', () => {
  assert.equal(sampleOf([{install: ''}, {install: ''}, {install: ''}]).installs, 0);
  assert.equal(sampleOf([{install: 'a'}, {install: 'a'}, {install: 'b'}]).enough, false);
});

test('a card arriving through /api/controls stores the hashed install, so installs can be counted', async () => {
  const e = {STATS: d1(), STATS_KEY: 'k', STATS_API_KEY: 'api', WAITLIST: {get: async () => null, put: async () => {}}};
  const send = install => worker.fetch(new Request('https://w.dev/api/controls', {method: 'POST', body: JSON.stringify({install, cards: [{id: `fill-${install}-abc`, board: 'ashby', v: '0.9.1', required: 5, filled: 4, left: 1, causes: {}, kinds: {text: 1}, ai: 'used', seconds: 30}]}), headers: {'Content-Type': 'application/json'}}), e, {});
  await send('install-aaaa'); await send('install-bbbb');
  const rows = e.STATS.db.prepare('SELECT install FROM fill_cards').all().map(r => r.install);
  assert.equal(new Set(rows).size, 2);
  assert.ok(rows.every(x => /^[0-9a-f]{16}$/.test(x)), 'a hash, never the install id');
});

// The owner's pool sends form counts too (source 'pool', migration 0069): they are stored apart and never reach a real-use number (the page's table, tiles, marks, the overview and trends).
test('a pool report never reaches the real-use queries; a plain install does', async () => {
  const e = {STATS: d1(), STATS_KEY: 'k', STATS_API_KEY: 'api', WAITLIST: {get: async () => null, put: async () => {}}};
  const body = {exposure: [{board: 'ashby', n: 7, required: 70, starred: 5}], unfilled: [{board: 'ashby', reason: 'unread', n: 9}]};
  const send = (extra, headers = {}) => worker.fetch(new Request('https://w.dev/api/controls', {method: 'POST', body: JSON.stringify({install: 'pool-qa-smoke', ...body, ...extra}), headers: {'Content-Type': 'application/json', ...headers}}), e, {});
  await send({source: 'pool'}, {Authorization: 'Bearer api'});   // the owner's pool
  await send({source: 'pool'});                                  // someone else claiming it: counted as that install's own, never as the pool
  await send({});                                                // a plain install
  const stored = table => e.STATS.db.prepare(`SELECT source, SUM(n) AS n FROM ${table} GROUP BY source ORDER BY source`).all().map(r => [r.source, r.n]);
  assert.deepEqual(stored('form_exposure'), [['pool', 7], ['user', 14]]);
  assert.deepEqual(stored('fill_reasons'), [['pool', 9], ['user', 18]]);
  const data = await report(e.STATS, new Date());
  assert.equal(data.use.now.fills, 14, 'the real-use table counts the two user reports only');
  assert.equal(data.use.reasons.find(r => r.reason === 'unread').now, 18);
  assert.equal(data.marks[0].starred, 10);
  assert.equal(data.families.unknown.fills + data.families.claude.fills + data.families.openai.fills, 14);
});
