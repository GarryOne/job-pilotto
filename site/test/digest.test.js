// The form-filling learning digest (src/digest.js) and the fill records it reads (src/recipes.js, POST /api/controls).
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../src/index.js';
import {byVersion, digest, markdown} from '../src/digest.js';
import {page, report} from '../src/formlearning.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const now = new Date('2026-10-12T12:00:00Z');
const card = (db, id, day, version, {required = 10, filled = 8, causes = {}, unread = 0, submitted = 1, by_you = 0} = {}) =>
  db.db.prepare(`INSERT INTO fill_cards (id, day, board, version, required, filled, left_n, unread, causes, kinds, submitted, by_you, seconds)
    VALUES (?, ?, 'ashby', ?, ?, ?, ?, ?, ?, '{"radio":1}', ?, ?, 40)`).run(id, day, version, required, filled, required - filled, unread, JSON.stringify(causes), submitted, by_you);

test('efficiency per day and per release, and weaknesses ranked by impact with their area and per-release rate', async () => {
  const db = d1();
  // Last week, 0.8.95: two required questions never read per form. This week, 0.8.97: fixed, but no data for "notice period".
  for (let i = 0; i < 3; i++) card(db, `old-card-${i}`, '2026-10-03', '0.8.95', {filled: 6, causes: {unread: 2, no_data: 2}, unread: 2});
  for (let i = 0; i < 4; i++) card(db, `new-card-${i}`, '2026-10-10', '0.8.97', {filled: i === 0 ? 10 : 9, causes: i === 0 ? {} : {no_data: 1}, by_you: i === 0 ? 0 : 1});
  const d = await digest(db, now);
  assert.deepEqual([d.thisWeek.forms, d.thisWeek.filledShare, d.thisWeek.formsNeedingNothing, d.lastWeek.filledShare, d.lastWeek.unreadPer100], [4, 0.925, 0.25, 0.6, 20]);
  assert.deepEqual(d.versions.map(v => [v.version, v.filledShare]), [['0.8.95', 0.6], ['0.8.97', 0.925]]);
  const top = d.weaknesses[0];
  assert.equal(top.id, 'cause:no_data:ashby');
  assert.match(top.area, /^data:/);
  assert.deepEqual(top.byVersion.map(v => [v.version, v.per100]), [['0.8.95', 20], ['0.8.97', 7.5]]);
  assert.ok(!d.weaknesses.some(w => w.id.startsWith('lab:')), 'the form lab was retired 9 Oct 2026');
  assert.ok(!d.weaknesses.some(w => w.id === 'cause:unread:ashby'), 'fixed by 0.8.97: not a weakness this week');
  const md = markdown(d);
  for (const text of ['# Form-filling learning digest', 'no_data on ashby', '| 0.8.97 | 4 | 93% |']) assert.ok(md.includes(text), text);
  assert.ok(byVersion('0.8.100', '0.8.97') > 0);
});

// 9 Oct 2026: AI proposals (to confirm, never typed) were counted as losses, so the biggest weakness could never move.
test('proposed answers are shown apart: filled / proposed / truly missing, and never ranked as a weakness', async () => {
  const db = d1();
  for (let i = 0; i < 3; i++) card(db, `prop-card-${i}`, '2026-10-10', '0.9.126', {filled: 6, causes: {proposed: 3, ai_declined: 1}});
  const d = await digest(db, now);
  assert.deepEqual([d.thisWeek.filledShare, d.thisWeek.proposedShare, d.thisWeek.missingShare], [0.6, 0.3, 0.1]);
  assert.ok(!d.weaknesses.some(w => w.cause === 'proposed'));
  assert.ok(d.weaknesses.some(w => w.id === 'cause:ai_declined:ashby'));
  assert.ok(markdown(d).includes('proposed to confirm 30%') && markdown(d).includes('| 0.9.126 | 3 | 60% | 30% | 10% |'));
});

// 9 Oct 2026 (owner: "how are we improving from one iteration to another ... by leveraging data"): what people did with proposed answers.
test('proposed answers: the app\'s counts arrive through /api/controls and the digest shows the share used, per source and release', async () => {
  const e = {STATS: d1(), STATS_KEY: 'k', STATS_API_KEY: 'api', WAITLIST: {get: async () => null, put: async () => {}}};
  const send = body => worker.fetch(new Request('https://w.dev/api/controls', {method: 'POST', body: JSON.stringify({install: 'install-1234', ...body}), headers: {'Content-Type': 'application/json'}}), e, {});
  const use = (source, act, n, v = '0.6.0') => ({board: 'h:c1c2a7e7e0', source, act, v, n});
  await send({proposalUses: [use('fill_guess', 'shown', 4), use('fill_guess', 'used', 2), use('fill_guess', 'edited', 1), use('profile', 'shown', 1),
    use('cv', 'used', 1, 'not a version!'), {board: 'h:c1c2a7e7e0', source: 'secret', act: 'shown', n: 1}]});
  const stored = e.STATS.db.prepare('SELECT source, act, version, n FROM proposal_use ORDER BY source, act').all().map(r => [r.source, r.act, r.version, r.n]);
  assert.deepEqual(stored, [['cv', 'used', '', 1], ['fill_guess', 'edited', '0.6.0', 1], ['fill_guess', 'shown', '0.6.0', 4], ['fill_guess', 'used', '0.6.0', 2], ['profile', 'shown', '0.6.0', 1]]);
  const d = await digest(e.STATS, new Date());
  assert.deepEqual([d.proposals.thisWeek.shown, d.proposals.thisWeek.used, d.proposals.thisWeek.edited], [5, 3, 1]);
  const guess = d.proposals.bySource.find(s => s.source === 'fill_guess').now;
  assert.deepEqual([guess.usedShare, guess.editedShare, guess.ignoredShare], [0.5, 0.25, 0.25]);
  assert.deepEqual(d.proposals.byVersion.map(v => [v.version, v.shown]), [['0.6.0', 5]]);
  const md = markdown(d);
  assert.ok(md.includes('## Proposed answers') && md.includes('| fill_guess | 4 | 50% | 25% | 25% |'), md.slice(md.indexOf('## Proposed')));
  const html = page(await report(e.STATS, new Date()), new URL('https://www.jobpilotto.top/admin/form-filling'));
  assert.match(html, /🎯 Proposed answers: used as proposed/);
  assert.match(html, /<td>fill_guess<\/td><td class="n">4<\/td><td class="n">50%<\/td>/);
});

test('fill records and their Submit arrive through /api/controls; the digest is for admins and the scripts\' key', async () => {
  const e = {STATS: d1(), STATS_KEY: 'k', STATS_API_KEY: 'api', WAITLIST: {get: async () => null, put: async () => {}}};
  const send = body => worker.fetch(new Request('https://w.dev/api/controls', {method: 'POST', body: JSON.stringify({install: 'install-1234', ...body}), headers: {'Content-Type': 'application/json'}}), e, {});
  await send({cards: [{id: 'fill-0001-abc', board: 'ashby', v: '0.8.97', required: 5, filled: 4, left: 1, causes: {ai_unsure: 1}, kinds: {text: 1}, ai: 'used', seconds: 30}]});
  await send({submits: [{id: 'fill-0001-abc', submitted: true, by_you: 1}]});
  const row = e.STATS.db.prepare('SELECT * FROM fill_cards').get();
  assert.deepEqual([row.board, row.version, row.required, row.filled, row.causes, row.submitted, row.by_you], ['ashby', '0.8.97', 5, 4, '{"ai_unsure":1}', 1, 1]);
  const get = (path, headers = {}) => worker.fetch(new Request(`https://w.dev${path}`, {headers}), e, {});
  assert.equal((await get('/admin/form-filling/digest.json')).status, 404);
  assert.equal((await get('/admin/form-filling/digest.json', {Authorization: 'Bearer api'})).status, 200);
  assert.match(await (await get('/admin/form-filling/digest.md', {Authorization: 'Bearer api'})).text(), /^# Form-filling learning digest/);
});

// The form lab was retired 9 Oct 2026 (owner): its endpoint (runs in, plan out) is gone.
test('the form lab\'s endpoint is gone', async () => {
  const e = {STATS: d1(), STATS_KEY: 'k', STATS_API_KEY: 'api', WAITLIST: {get: async () => null, put: async () => {}},
    ASSETS: {fetch: async () => new Response('Not found', {status: 404})}};   // an unknown path falls through to the static site
  for (const method of ['GET', 'POST']) {
    const response = await worker.fetch(new Request('https://w.dev/api/lab', {method, headers: {Authorization: 'Bearer api'}, ...(method === 'POST' ? {body: '{"runs":[]}'} : {})}), e, {});
    assert.notEqual(response.status, 200, method);
  }
});

// 9 Oct 2026: weekly and per-release rows were too thin to show progress (cards start 5 Oct, versions change hourly). Recent vs earlier moves within days.
test('recent vs earlier: the last 3 days against the days before, in the totals and per weakness', async () => {
  const db = d1();
  card(db, 'early-card-1', '2026-10-07', '0.9.1', {filled: 5, causes: {no_data: 5}});   // now = 12 Oct: earlier = 6-9 Oct
  card(db, 'late-card-01', '2026-10-11', '0.9.2', {filled: 9, causes: {no_data: 1}});   // recent = 10-12 Oct
  const d = await digest(db, now);
  assert.deepEqual([d.recent.from, d.recent.forms, d.recent.filledShare, d.earlier.forms, d.earlier.filledShare], ['2026-10-10', 1, 0.9, 1, 0.5]);
  const w = d.weaknesses.find(item => item.id === 'cause:no_data:ashby');
  assert.deepEqual([w.recent.per100, w.earlier.per100], [10, 50]);
  const md = markdown(d);
  assert.ok(md.includes('**Recent vs earlier** (since 2026-10-10') && md.includes('recent vs earlier (per 100 required): 10 (1 forms) vs 50 (1 forms)'));
});

// Layer 4 of the applying reliability spec (10 Oct 2026): a board whose fill rate fell by more than 10 points (5+ forms on each side) is flagged.
test('per board: recent vs earlier fill rate, and a drop flagged only with enough forms on each side', async () => {
  const db = d1();
  const on = (board, id, day, filled) => db.db.prepare(`INSERT INTO fill_cards (id, day, board, version, required, filled, left_n, unread, causes, kinds, submitted, by_you, seconds)
    VALUES (?, ?, ?, '0.9.1', 10, ?, ?, 0, '{}', '{}', 0, 0, 30)`).run(id, day, board, filled, 10 - filled);
  for (let i = 0; i < 5; i++) { on('greenhouse', `g-old-${i}`, '2026-10-07', 9); on('greenhouse', `g-new-${i}`, '2026-10-11', 6); }
  for (let i = 0; i < 5; i++) on('workday', `w-old-${i}`, '2026-10-07', 9);
  for (let i = 0; i < 3; i++) on('workday', `w-new-${i}`, '2026-10-11', 2);   // a big drop, but only 3 recent forms: not flagged yet
  const boards = Object.fromEntries((await digest(db, now)).boards.map(b => [b.board, b]));
  assert.deepEqual([boards.greenhouse.earlierFilledShare, boards.greenhouse.recentFilledShare, boards.greenhouse.dropped], [0.9, 0.6, true]);
  assert.deepEqual([boards.workday.recentForms, boards.workday.dropped], [3, false]);
});
