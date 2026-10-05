// The owner's /smart-form-filling page (src/formlearning.js): the lab's reading and operating rates per board, real-use misses per 100
// required questions, the recipe funnel and the questions to fix next, this week vs last, from the tables the site already keeps.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {page, report, view} from '../src/formlearning.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0004_recipes.sql', '0005_lab.sql', '0006_exposure.sql', '0017_alias_proposals.sql', '0022_form_required.sql']) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const now = new Date('2026-10-12T12:00:00Z');
function seed(db) {
  const lab = db.db.prepare('INSERT INTO lab_runs (day, site, fingerprint, kind, recipe, ok, why, url) VALUES (?, ?, ?, ?, 0, ?, ?, ?)');
  // Last week on ashby: 7 of 10 required questions read; this week: 10 of 10. Operating: 3 of 4, then 4 of 4.
  for (let i = 0; i < 10; i++) lab.run('2026-10-03', 'ashby', `q${i}fingerprint`, 'question', i < 7 ? 1 : 0, i < 7 ? '' : 'question on the page not read', 'https://jobs.ashbyhq.com/acme/1/application');
  for (let i = 0; i < 10; i++) lab.run('2026-10-10', 'ashby', `q${i}fingerprint`, 'question', 1, '', 'https://jobs.ashbyhq.com/acme/1/application');
  for (let i = 0; i < 4; i++) lab.run('2026-10-03', 'ashby', `w${i}fingerprint`, 'toggle-group', i < 3 ? 1 : 0, '', '');
  for (let i = 0; i < 4; i++) lab.run('2026-10-10', 'ashby', `w${i}fingerprint`, 'toggle-group', 1, '', '');
  // A greenhouse question the lab could not read this week: on the "fix next" list with its wording.
  lab.run('2026-10-11', 'greenhouse', 'gh1fingerprint', 'question', 0, 'question on the page not read', 'https://job-boards.greenhouse.io/acme/jobs/1');
  db.db.prepare("INSERT INTO control_samples (fingerprint, kind, skeleton, question, seen_at) VALUES ('gh1fingerprint', 'question', '{}', 'Team size', '2026-10-11')").run();
  // Real use: 50 required questions over 5 forms this week, 3 unread; last week 40 over 4 forms, 6 unread.
  db.db.prepare("INSERT INTO form_exposure (day, board, n, required) VALUES ('2026-10-09', 'ashby', 5, 50), ('2026-10-02', 'ashby', 4, 40)").run();
  db.db.prepare("INSERT INTO fill_reasons (day, board, reason, n) VALUES ('2026-10-09', 'ashby', 'unread', 3), ('2026-10-02', 'ashby', 'unread', 6), ('2026-10-09', 'ashby', 'by_you', 2)").run();
  db.db.prepare(`INSERT INTO recipes (fingerprint, version, status, rollout, body, source, note, created_at, updated_at) VALUES
    ('a', 1, 'verified', 100, '{}', 'lab', '', '2026-09-20', '2026-10-01'), ('b', 1, 'candidate', 0, '{}', 'proposer', '', '2026-10-11', '2026-10-11')`).run();
}

test('this week vs last: lab reading and operating per board, real-use misses per 100 required questions, recipes, what to fix next', async () => {
  const db = d1();
  seed(db);
  const data = await report(db, now);
  const ashby = data.lab.find(b => b.board === 'ashby');
  assert.deepEqual([ashby.reading.before.rate, ashby.reading.now.rate, ashby.operating.before.rate, ashby.operating.now.rate], [0.7, 1, 0.75, 1]);
  const unread = data.use.reasons.find(r => r.reason === 'unread');
  assert.deepEqual([unread.rateNow, unread.rateBefore, data.use.unitNow], [6, 15, 'required questions']);
  assert.deepEqual([data.recipes.verified.n, data.recipes.candidate.n, data.recipes.candidate.fresh], [1, 1, 1]);
  assert.deepEqual(data.unread.map(u => [u.question, u.site]), [['Team size', 'greenhouse']]);
  const html = page(data);
  for (const text of ['smart form filling', 'Reading (lab)', 'Team size', 'Required question on the page, not read']) assert.ok(html.includes(text), text);
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
  assert.ok((await ok.text()).includes('No lab runs yet.'));
});
