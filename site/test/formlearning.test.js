// The owner's /smart-form-filling page (src/formlearning.js): real-use misses per 100 required questions and the recipe funnel, this
// week vs last, from the tables the site already keeps. The form lab was retired 9 Oct 2026: nothing of it is shown.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {page, report, resultsFrom, view} from '../src/formlearning.js';
import {FLOW_STATES} from '../src/knowledge.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0004_recipes.sql', '0005_lab.sql', '0006_exposure.sql', '0017_alias_proposals.sql', '0022_form_required.sql', '0009_knowledge.sql', '0044_family_counts.sql']) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const now = new Date('2026-10-12T12:00:00Z');
function seed(db) {
  // Real use: 50 required questions over 5 forms this week, 3 unread; last week 40 over 4 forms, 6 unread.
  db.db.prepare("INSERT INTO form_exposure (day, board, n, required) VALUES ('2026-10-09', 'ashby', 5, 50), ('2026-10-02', 'ashby', 4, 40)").run();
  db.db.prepare("INSERT INTO fill_reasons (day, board, reason, n) VALUES ('2026-10-09', 'ashby', 'unread', 3), ('2026-10-02', 'ashby', 'unread', 6), ('2026-10-09', 'ashby', 'by_you', 2)").run();
  db.db.prepare(`INSERT INTO recipes (fingerprint, version, status, rollout, body, source, note, created_at, updated_at) VALUES
    ('a', 1, 'verified', 100, '{}', 'lab', '', '2026-09-20', '2026-10-01'), ('b', 1, 'candidate', 0, '{}', 'proposer', '', '2026-10-11', '2026-10-11')`).run();
}

test('this week vs last: real-use misses per 100 required questions and recipes; no form lab', async () => {
  const db = d1();
  seed(db);
  const data = await report(db, now);
  const unread = data.use.reasons.find(r => r.reason === 'unread');
  assert.deepEqual([unread.rateNow, unread.rateBefore, data.use.unitNow], [6, 15, 'required questions']);
  assert.deepEqual([data.recipes.verified.n, data.recipes.candidate.n, data.recipes.candidate.fresh], [1, 1, 1]);
  const html = page(data);
  for (const text of ['Form filling', 'Filled (real use)', 'Required question on the page, not read']) assert.ok(html.includes(text), text);
  for (const text of ['(lab)', 'The lab, per board', 'the lab could not read']) assert.ok(!html.includes(text), text);
});

test('an app that sends no required count is measured per 100 forms', async () => {
  const db = d1();
  db.db.prepare("INSERT INTO form_exposure (day, board, n) VALUES ('2026-10-09', 'ashby', 4)").run();
  db.db.prepare("INSERT INTO fill_reasons (day, board, reason, n) VALUES ('2026-10-09', 'ashby', 'unread', 2)").run();
  const data = await report(db, now);
  assert.deepEqual([data.use.unitNow, data.use.reasons.find(r => r.reason === 'unread').rateNow], ['forms', 50]);
});

test('owner-only: the page is a 404 without the stats key', async () => {
  assert.equal((await view(new Request('https://x.dev/smart-form-filling'), {STATS_KEY: 'secret', STATS: d1()}, now)).status, 404);
  const ok = await view(new Request('https://x.dev/smart-form-filling', {headers: {Authorization: 'Bearer secret'}}), {STATS_KEY: 'secret', STATS: d1()}, now);
  assert.equal(ok.status, 200);
  assert.ok((await ok.text()).includes('Filled (real use)'));
});

test('how applications ended: submitted clean / assisted / by Claude and failed where, this week vs last, per board, with the success rate', async () => {
  const db = d1();
  const put = db.db.prepare('INSERT INTO flow_outcomes (day, board, state, n) VALUES (?, ?, ?, ?)');
  put.run('2026-10-10', 'ashby', 'submitted-clean', 6); put.run('2026-10-10', 'ashby', 'submitted-assisted', 3); put.run('2026-10-11', 'ashby', 'failed-account', 1);
  put.run('2026-10-11', 'h:0123456789', 'failed-no-form', 2); put.run('2026-10-03', 'ashby', 'submitted-clean', 1); put.run('2026-10-03', 'ashby', 'failed-abandoned', 1);
  put.run('2026-10-10', 'ashby', 'filled', 40);   // a fill word, not an end: not counted here
  const data = await report(db, now);
  assert.deepEqual([data.results.now.submitted, data.results.now.failed, data.results.now.finished, data.results.now.successRate], [9, 3, 12, 0.75]);
  assert.equal(data.results.before.successRate, 0.5);
  assert.deepEqual([data.results.now.cleanShare, data.results.now.assistedShare], [6 / 9, 3 / 9]);
  assert.deepEqual(data.results.boards.map(b => [b.board, b.finished]), [['ashby', 10], ['h:0123456789', 2]]);
  const html = page(data);
  for (const text of ['How applications ended', 'Submitted, you fixed fields', 'Failed at sign-in or sign-up', '75%']) assert.ok(html.includes(text), text);
});

test('the results block is honest when nothing was reported yet, and the site accepts exactly the words the app sends', async () => {
  assert.equal(resultsFrom([], '2026-10-06', '2026-09-29').now.successRate, null);
  const db = d1();
  assert.ok(page(await report(db, now)).includes('No finished applications reported yet'));
  for (const word of ['submitted-clean', 'submitted-assisted', 'submitted-claude', 'failed-no-form', 'failed-account', 'failed-abandoned']) assert.ok(FLOW_STATES.includes(word), word);
});

test('the page links to the applying scorecard, where real use meets the pool\'s tests', () => {
  assert.match(readFileSync(new URL('../src/formlearning.js', import.meta.url), 'utf8'), /href="\/admin\/applying">Applying tests → platform scorecard/);
});
