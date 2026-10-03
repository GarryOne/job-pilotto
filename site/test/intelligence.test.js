// What the installs teach about the job search (src/intelligence.js): what is stored, what is refused, what the owner sees.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {controls} from '../src/recipes.js';
import {report, store, tidy, view} from '../src/intelligence.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0004_recipes.sql', '0005_lab.sql', '0006_exposure.sql', '0014_intelligence.sql', '0009_knowledge.sql', '0016_intel_signals.sql', '0017_alias_proposals.sql', '0019_scouting.sql']) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const env = () => ({STATS: d1(), STATS_KEY: 'secret'});
const now = new Date('2026-10-02T12:00:00Z');
const tables = e => Object.fromEntries(['intel_terms', 'intel_coverage', 'intel_missed', 'intel_dismiss', 'intel_scores'].map(name => [name, e.STATS.db.prepare(`SELECT * FROM ${name}`).all().map(row => ({...row}))]));

test('accepted role words are stored by fixed role and region tags; anything off the lists is refused or generalised', async () => {
  const e = env();
  const out = await store(e, {terms: [{term: 'Backend', role: 'sre_devops', region: 'europe'}, {term: 'distributed systems', role: 'made-up', region: 'atlantis'}, {term: '<script>', role: 'software', region: 'europe'}, {term: 'a', role: 'software', region: 'europe'}]}, now);
  assert.equal(out.terms, 2);
  assert.deepEqual(tables(e).intel_terms.map(r => [r.term, r.role, r.region, r.n]), [['backend', 'sre_devops', 'europe', 1], ['distributed systems', 'other', 'none', 1]]);
});

test('a crawl report adds up postings in places, matches and the missed role words; matched can never exceed what is in places', async () => {
  const e = env();
  await store(e, {coverage: {role: 'sre_devops', region: 'europe', in_places: 3142, matched: 164, missed: [{term: 'backend', count: 49}, {term: 'bad term!', count: 5}, {term: 'storage', count: 0}]}}, now);
  await store(e, {coverage: {role: 'sre_devops', region: 'europe', in_places: 100, matched: 900, missed: [{term: 'backend', count: 10}]}}, now);
  const t = tables(e);
  assert.deepEqual(t.intel_coverage.map(r => [r.reports, r.in_places, r.matched]), [[2, 3242, 264]]);   // 900 matched is clamped to the 100 in places
  assert.deepEqual(t.intel_missed.map(r => [r.term, r.count, r.reports]), [['backend', 59, 2]]);
  assert.equal((await store(e, {coverage: {role: 'x', region: 'y', in_places: 0, matched: 0}}, now)).coverage, 0);   // nothing in places: nothing to say
});

test('dismiss reasons and the score snapshot accept only the fixed words and bands', async () => {
  const e = env();
  const out = await store(e, {dismissals: [{reason: 'seniority', bucket: '60-79', n: 1}, {reason: 'seniority', bucket: '60-79', n: 2}, {reason: 'my boss is a jerk', bucket: '60-79', n: 1}, {reason: 'tech', bucket: '999', n: 1}],
    snapshot: [{bucket: '80-100', state: 'applied', n: 4}, {bucket: '80-100', state: 'banana', n: 4}, {bucket: 'unscored', state: 'new', n: 12}]}, now);
  assert.deepEqual([out.dismissals, out.snapshot], [2, 2]);
  const t = tables(e);
  assert.deepEqual(t.intel_dismiss.map(r => [r.reason, r.bucket, r.n]), [['seniority', '60-79', 3]]);
  assert.deepEqual(t.intel_scores.map(r => [r.bucket, r.state, r.n]), [['80-100', 'applied', 4], ['unscored', 'new', 12]]);
});

test('no table can hold an install, a title, a company or free text', () => {
  const e = env();
  for (const name of ['intel_terms', 'intel_coverage', 'intel_missed', 'intel_dismiss', 'intel_scores']) {
    const columns = e.STATS.db.prepare(`PRAGMA table_info(${name})`).all().map(c => c.name);
    assert.ok(columns.every(c => !/install|title|company|url|text|note|email/i.test(c)), `${name}: ${columns}`);
  }
});

test('the report names a role word only once enough people chose it, and shows what the score predicts', async () => {
  const e = env();
  for (let i = 0; i < 3; i++) await store(e, {terms: [{term: 'backend', role: 'sre_devops', region: 'europe'}]}, now);
  await store(e, {terms: [{term: 'storage', role: 'sre_devops', region: 'europe'}]}, now);
  await store(e, {snapshot: [{bucket: '80-100', state: 'new', n: 10}, {bucket: '80-100', state: 'applied', n: 6}, {bucket: '80-100', state: 'interviewing', n: 4}, {bucket: '80-100', state: 'dismissed', n: 0},
    {bucket: '40-59', state: 'new', n: 70}, {bucket: '40-59', state: 'dismissed', n: 20}, {bucket: '40-59', state: 'applied', n: 10}]}, now);
  const r = await report(e.STATS, 30, now);
  assert.deepEqual(r.terms.map(t => [t.term, t.n]), [['backend', 3]]);   // storage was chosen by one person: not named
  assert.equal(r.hiddenTerms, 1);
  const high = r.scores.find(s => s.bucket === '80-100'), mid = r.scores.find(s => s.bucket === '40-59');
  assert.deepEqual([high.total, Math.round(high.acted * 100), Math.round(high.interviewed * 100)], [20, 50, 20]);
  assert.deepEqual([mid.total, Math.round(mid.acted * 100), Math.round(mid.dismissed * 100)], [100, 10, 20]);
});

test('/intel is for the owner only and shows the sections', async () => {
  const e = env();
  await store(e, {dismissals: [{reason: 'location', bucket: '40-59', n: 3}], coverage: {role: 'sre_devops', region: 'europe', in_places: 100, matched: 5, missed: [{term: 'backend', count: 30}]}}, now);
  assert.equal((await view(new Request('https://x/intel'), e, now)).status, 404);
  const page = await (await view(new Request('https://x/intel', {headers: {Authorization: 'Bearer secret'}}), e, now)).text();
  assert.match(page, /Is the search too narrow\?/);
  assert.match(page, /sre_devops<\/td><td>europe<\/td><td>1<\/td><td>5%/);
  assert.match(page, /Why jobs are dismissed[\s\S]*location/);
  assert.match(page, /Does the score predict action\?/);
});

test('POST /api/controls carries it, counts it against the daily limit, and a missing table never breaks the rest', async () => {
  const e = env();
  const send = body => controls(new Request('https://x/api/controls', {method: 'POST', body: JSON.stringify({install: 'install-aaaa-1111', ...body})}), e, now);
  assert.equal((await send({intel: {dismissals: [{reason: 'tech', bucket: '80-100', n: 1}]}})).status, 200);
  assert.equal(tables(e).intel_dismiss.length, 1);
  e.STATS.db.exec('DROP TABLE intel_dismiss;');
  assert.equal((await send({intel: {dismissals: [{reason: 'tech', bucket: '80-100', n: 1}]}})).status, 200);   // swallowed: the report still succeeds
});

test('replies by score band, source kinds and corrected answers: stored, bounded and shown only when enough people and outcomes back them', async () => {
  const e = env();
  await store(e, {replies: [{bucket: '80-100', outcome: 'screening', n: 12}, {bucket: '80-100', outcome: 'no_response', n: 8}, {bucket: '40-59', outcome: 'reply', n: 2}, {bucket: '40-59', outcome: 'no_response', n: 18},
    {bucket: 'bad', outcome: 'reply', n: 5}, {bucket: '80-100', outcome: 'banana', n: 5}],
    sources: [{board: 'greenhouse', seen: 100, acted: 30, dismissed: 20, heard: 6}, {board: 'h:abc', seen: 50, acted: 1, dismissed: 1, heard: 0}, {board: 'other', seen: 5, acted: 99, dismissed: 0, heard: 0}]}, now, 'install-aaaa-1111');
  for (const install of ['install-aaaa-1111', 'install-bbbb-2222', 'install-cccc-3333']) {
    await store(e, {fixes: [{label: 'Notice period', filled: 10, corrected: 6}, {label: 'Your <b>name</b>', filled: 2, corrected: 1}]}, now, install);
  }
  await store(e, {fixes: [{label: 'Only mine', filled: 50, corrected: 50}]}, now, 'install-aaaa-1111');
  const r = await report(e.STATS, 30, now);
  assert.deepEqual(r.replies.map(x => [x.bucket, x.total, x.rate == null ? null : Math.round(x.rate * 100)]), [['40-59', 20, 10], ['80-100', 20, 60]]);
  assert.deepEqual(r.sources.map(x => [x.board, x.seen, x.acted]), [['greenhouse', 100, 30], ['other', 5, 5]]);   // a hashed host is refused, acted is clamped to seen
  assert.deepEqual(r.fixes.map(x => [x.label, x.filled, x.corrected]), [['notice period', 30, 18]]);   // "Only mine" has one install; the name label has too few fills
  const page = await (await view(new Request('https://x/intel', {headers: {Authorization: 'Bearer secret'}}), e, now)).text();
  assert.match(page, /Do higher scores get replies\?[\s\S]*80-100<\/td><td>20<\/td><td>60%/);
  assert.match(page, /Answers people change[\s\S]*notice period<\/td><td>30<\/td><td><b>60%/);
});

test('tidy drops a corrected-answer label that fewer than 3 installs reported once it is two weeks old', async () => {
  const e = env();
  await store(e, {fixes: [{label: 'Only mine', filled: 5, corrected: 1}]}, now, 'install-aaaa-1111');
  assert.deepEqual(await tidy(e.STATS, now), {dropped: 0});
  assert.deepEqual(await tidy(e.STATS, new Date('2026-10-20T00:00:00Z')), {dropped: 1});
});

test('hints need 50 dismissals and a reason at 30%+; the calibration says whether the score predicts replies', async () => {
  const {hints, calibration} = await import('../src/intelligence.js');
  const e = env();
  await store(e, {dismissals: [{reason: 'seniority', bucket: '60-79', n: 20}, {reason: 'other', bucket: '60-79', n: 20}]}, now);
  assert.deepEqual(await hints(e.STATS, now), []);   // 40 dismissals: not enough
  await store(e, {dismissals: [{reason: 'tech', bucket: '60-79', n: 15}, {reason: 'location', bucket: '40-59', n: 5}]}, now);
  assert.deepEqual(await hints(e.STATS, now), [{reason: 'seniority', share: 0.33}]);   // 20 of 60; tech is 25% and "other" is never a hint
  const rows = rate => [{bucket: '80-100', rate: rate[0]}, {bucket: '60-79', rate: rate[1]}];
  assert.equal(calibration(rows([0.5, 0.2])).status, 'ok');
  assert.equal(calibration(rows([0.22, 0.2])).status, 'flat');
  assert.equal(calibration(rows([0.1, 0.2])).status, 'inverted');
  assert.equal(calibration(rows([null, 0.2])).status, 'thin');
});

test('board benchmarks need 30+ applications on a known board, and say how many heard back and when', async () => {
  const {benchmarks} = await import('../src/knowledge.js');
  const e = env();
  e.STATS.db.exec(readFileSync(new URL('../migrations/0013_application_outcomes.sql', import.meta.url), 'utf8'));
  const add = (board, outcome, days, n) => e.STATS.db.prepare('INSERT INTO application_outcomes (day, board, outcome, days, n) VALUES (?, ?, ?, ?, ?)').run('2026-09-30', board, outcome, days, n);
  add('greenhouse', 'reply', '4-7', 10); add('greenhouse', 'screening', '8-14', 4); add('greenhouse', 'no_response', '31+', 36);   // 50 marked, 14 heard (28%), middle bucket 4-7
  add('lever', 'reply', '0-3', 5); add('h:abc1234567', 'reply', '0-3', 99);
  assert.deepEqual(await benchmarks(e.STATS, now), [{board: 'greenhouse', n: 50, heard: 0.28, days: '4-7'}]);
});

test('why fields stay empty: fixed reason words per board are summed, the rest is refused, and the page shows the shares', async () => {
  const e = env();
  const {store: storeKnowledge} = await import('../src/knowledge.js');
  await storeKnowledge(e, {unfilled: [{board: 'ashby', reason: 'no_answer', n: 3}, {board: 'ashby', reason: 'not_taken', n: 1}, {board: 'bad board!', reason: 'no_answer', n: 9},
    {board: 'ashby', reason: 'my salary is 90k', n: 5}]}, 'install-a-0001', now);
  await storeKnowledge(e, {unfilled: [{board: 'lever', reason: 'no_answer', n: 2}]}, 'install-b-0002', now);
  const data = await report(e.STATS, 30, now);
  assert.deepEqual(data.reasons.map(r => [r.reason, r.n, r.share]), [['no_answer', 5, 5 / 6], ['not_taken', 1, 1 / 6]]);
  const html = await (await view(new Request('https://x/intel', {headers: {Authorization: 'Bearer secret'}}), {...e, STATS: e.STATS}, now)).text();
  assert.match(html, /Why fields stay empty/);
  assert.match(html, /No answer in the profile/);
});

test('the owner page is not shadowed by the public one: /intel has no static asset', async () => {
  const fs = await import('node:fs');
  const assets = fs.readdirSync(new URL('../public/', import.meta.url));
  assert.ok(assets.includes('intelligence.html'));  // public, served before the Worker
  assert.ok(!assets.some(name => name === 'intel' || name.startsWith('intel.')));
  const index = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(index, /pathname === '\/intel'\) return intelligenceView/);
});
