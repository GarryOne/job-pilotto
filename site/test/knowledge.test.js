// What installs report about question wording and where applications stall (src/knowledge.js).
import {useLaterFloors} from '../src/learning-floor.js';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {controls} from '../src/recipes.js';
import {cleanLabel, knowledge, report, tidy} from '../src/knowledge.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0004_recipes.sql', '0005_lab.sql', '0006_exposure.sql', '0009_knowledge.sql', '0017_alias_proposals.sql', '0022_form_required.sql', '0044_family_counts.sql']) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const env = () => ({STATS: d1(), STATS_KEY: 'secret'});
const day = n => new Date(Date.UTC(2026, 9, n, 12));
const send = (e, install, body, when = day(2)) => controls(new Request('https://x/api/controls', {method: 'POST', body: JSON.stringify({install, ...body})}), e, when);

test('the site cleans a label again; personal-looking text is never stored', async () => {
  assert.equal(cleanLabel('Heimatort *'), 'heimatort');
  const e = env();
  await send(e, 'install-aaaa-1111', {questions: [{label: 'Heimatort *', kind: 'text', board: 'greenhouse'}, {label: 'Mail jane@example.com', kind: 'text', board: 'greenhouse'},
    {label: 'Notice period', kind: 'select', board: 'bad board!'}, {label: '<b>x</b> hello', kind: 'text', board: 'ashby'}]});
  assert.deepEqual(e.STATS.db.prepare('SELECT label, kind, n FROM question_labels').all().map(r => ({...r})), [{label: 'heimatort', kind: 'text', n: 1}]);
});

test('a label counts installs by short digests, once each; the report shows only labels 3 or more installs reported', async t => {
  useLaterFloors(); t.after(() => useLaterFloors(false));   // the rule with a larger user base (src/learning-floor.js)
  const e = env();
  const ask = (install, label = 'Heimatort') => send(e, install, {questions: [{label, kind: 'text', board: 'lever'}]});
  await ask('install-aaaa-1111'); await ask('install-aaaa-1111'); await ask('install-bbbb-2222');
  assert.equal((await report(e.STATS, 7, day(2))).questions.length, 0);   // two installs: not yet
  await ask('install-cccc-3333');
  await ask('install-aaaa-1111', 'Only one asks this');
  const seen = await report(e.STATS, 7, day(2));
  assert.deepEqual(seen.questions.map(q => [q.label, q.n, q.installs, q.boards]), [['heimatort', 4, 3, ['lever']]]);
  const stored = e.STATS.db.prepare('SELECT installs FROM question_labels WHERE label = ?').get('heimatort').installs;
  assert.equal(stored.includes('install-aaaa'), false, 'only digests are kept');
});

test('flow outcomes add up per day, board and state; unknown states and boards are refused', async () => {
  const e = env();
  await send(e, 'install-aaaa-1111', {flows: [{board: 'ashby', state: 'no-form', n: 2}, {board: 'ashby', state: 'filled', n: 1}, {board: 'ashby', state: 'made-up', n: 5}, {board: 'bad board', state: 'filled', n: 1}]});
  await send(e, 'install-bbbb-2222', {flows: [{board: 'ashby', state: 'no-form', n: 3}]});
  assert.deepEqual((await report(e.STATS, 7, day(2))).flows.map(f => [f.board, f.state, f.n]), [['ashby', 'no-form', 5], ['ashby', 'filled', 1]]);
});

test('tidy deletes labels seen by fewer than 3 installs after 14 days, keeps the shared ones and drops old flow counts', async t => {
  useLaterFloors(); t.after(() => useLaterFloors(false));   // the rule with a larger user base (src/learning-floor.js)
  const e = env();
  for (const install of ['install-aaaa-1111', 'install-bbbb-2222', 'install-cccc-3333']) await send(e, install, {questions: [{label: 'Heimatort', kind: 'text', board: 'lever'}]}, day(1));
  await send(e, 'install-aaaa-1111', {questions: [{label: 'Odd question here', kind: 'text', board: 'lever'}], flows: [{board: 'ashby', state: 'filled', n: 1}]}, day(1));
  assert.deepEqual(await tidy(e.STATS, day(5)), {dropped: 0});   // too early
  assert.deepEqual(await tidy(e.STATS, new Date(Date.UTC(2026, 9, 20))), {dropped: 1});
  assert.deepEqual(e.STATS.db.prepare('SELECT label FROM question_labels').all().map(r => r.label), ['heimatort']);
});

const kvStore = () => { const map = new Map(); return {get: async key => map.get(key) ?? null, put: async (key, value) => { map.set(key, value); }}; };

test('only the owner reads the knowledge; the daily limit counts questions and flows too', async () => {
  const e = {...env(), WAITLIST: kvStore()};
  await send(e, 'install-aaaa-1111', {questions: [{label: 'Heimatort', kind: 'text', board: 'lever'}]});
  assert.equal((await knowledge(new Request('https://x/api/knowledge'), e, day(2))).status, 404);
  assert.equal((await knowledge(new Request('https://x/api/knowledge', {headers: {Authorization: 'Bearer secret'}}), e, day(2))).status, 200);
  assert.equal((await knowledge(new Request('https://x/api/knowledge', {method: 'POST', headers: {Authorization: 'Bearer secret'}}), e, day(2))).status, 405);
  const many = Array.from({length: 40}, (_, i) => ({label: `Question number ${i} please`, kind: 'text', board: 'lever'}));
  let last = 200;
  for (let i = 0; i < 20 && last === 200; i++) last = (await send(e, 'install-limit-0001', {questions: many})).status;
  assert.equal(last, 429);
});

test('application outcomes add up per board, outcome and days; nothing else is stored; unknown values are refused', async () => {
  const e = env();
  e.STATS.db.exec(readFileSync(new URL('../migrations/0013_application_outcomes.sql', import.meta.url), 'utf8'));
  await send(e, 'install-aaaa-1111', {applications: [{board: 'greenhouse', outcome: 'reply', days: '8-14', n: 1}, {board: 'greenhouse', outcome: 'reply', days: '8-14', n: 2},
    {board: 'ashby', outcome: 'rejected', days: '', n: 1}, {board: 'ashby', outcome: 'hired', days: '4-7', n: 1}, {board: 'bad board', outcome: 'offer', days: '4-7', n: 1},
    {board: 'lever', outcome: 'offer', days: '99 days', n: 1}, {company: 'Grafana', board: 'lever', outcome: 'offer', days: '0-3', n: 1}]});
  const rows = e.STATS.db.prepare('SELECT board, outcome, days, n FROM application_outcomes ORDER BY board, outcome').all().map(r => ({...r}));
  assert.deepEqual(rows, [{board: 'ashby', outcome: 'rejected', days: '', n: 1}, {board: 'greenhouse', outcome: 'reply', days: '8-14', n: 3}, {board: 'lever', outcome: 'offer', days: '0-3', n: 1}]);
  assert.deepEqual(e.STATS.db.prepare('PRAGMA table_info(application_outcomes)').all().map(c => c.name), ['day', 'board', 'outcome', 'days', 'n']);   // no company, role, url or install
  assert.deepEqual((await report(e.STATS, 7, day(2))).outcomes.map(o => [o.board, o.outcome, o.n]), [['ashby', 'rejected', 1], ['greenhouse', 'reply', 3], ['lever', 'offer', 1]]);
});
