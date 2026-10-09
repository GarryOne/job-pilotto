// The AI's answers per AI family (src/answer-metrics.js, migration 0046): owner, 9 Oct 2026, compare the AI itself, Claude vs OpenAI.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {medianBucket, ratesOf} from '../src/answer-metrics.js';
import {store, tidy} from '../src/knowledge.js';
import {page, report} from '../src/formlearning.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0002_telemetry.sql', '0004_recipes.sql', '0005_lab.sql', '0006_exposure.sql', '0009_knowledge.sql', '0017_alias_proposals.sql',
    '0022_form_required.sql', '0044_family_counts.sql', '0046_form_answers.sql']) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args) ?? null});
  return {db, d1: {prepare: sql => statement(sql)}};
}
const health = (db, install, aiEngine) => db.prepare(`INSERT INTO telemetry (day, at, kind, install, version, platform, fingerprint, summary, data)
  VALUES ('2026-10-09', '2026-10-09T10:00:00Z', 'health', ?, '0.6.0', 'darwin', 'health', 'health', ?)`).run(install, JSON.stringify({aiEngine}));
const entry = (engine, more = {}) => ({engine, calls: 2, fields: 10, returned: 9, kept: 8, empty: 1, unknown: 1, proposed: 2, cut: 0, ms: [1, 1, 0, 0, 0, 0], ...more});

test("a call is counted under its own engine's family, even when the install's health report names another", async () => {
  const {db, d1: STATS} = d1();
  health(db, 'install-claud1', 'cli');   // switched to Codex since its last health report
  const now = new Date('2026-10-09T12:00:00Z');
  await store({STATS}, {answers: [entry('codex'), entry('cli', {calls: 1, fields: 4, returned: 4, kept: 2, unknown: 0, ms: [0, 0, 1, 0, 0, 0]})]}, 'install-claud1', now);
  await store({STATS}, {answers: [entry('openai')]}, 'install-claud1', now);   // summed into the same day and family
  const rows = db.prepare('SELECT ai_family, calls, fields, kept, unknown, ms_5, ms_10, ms_20 FROM form_answers ORDER BY ai_family').all().map(row => ({...row}));
  assert.deepEqual(rows, [{ai_family: 'claude', calls: 1, fields: 4, kept: 2, unknown: 0, ms_5: 0, ms_10: 0, ms_20: 1},
    {ai_family: 'openai', calls: 4, fields: 20, kept: 16, unknown: 2, ms_5: 2, ms_10: 2, ms_20: 0}]);
});

test('an unknown engine, a call count of 0 and text are dropped; only fixed counts are stored', async () => {
  const {db, d1: STATS} = d1();
  const now = new Date('2026-10-09T12:00:00Z');
  const result = await store({STATS}, {answers: [entry('gemini'), entry('api', {calls: 0}), entry('api', {label: 'Your salary?', unknownIds: ['salary']})]}, 'install-x0001', now);
  assert.equal(result.answers, 1);
  const columns = db.prepare('PRAGMA table_info(form_answers)').all().map(column => column.name);
  assert.ok(!columns.some(name => /label|id|text|answer/.test(name.replace('ai_family', ''))), columns.join());
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM form_answers').get().n, 1);
  await tidy(STATS, new Date('2027-06-01T00:00:00Z'));   // older than 180 days: rolled off
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM form_answers').get().n, 0);
});

test('the rates: kept and left empty per question, wrong field per answer returned, the median call time from its bucket', () => {
  const rates = ratesOf({calls: 4, fields: 20, returned: 18, kept: 15, unknown: 3, proposed: 3, cut: 1, ms_5: 1, ms_10: 2, ms_20: 1, ms_40: 0, ms_80: 0, ms_more: 0});
  assert.deepEqual({...rates, median: rates.median}, {calls: 4, fields: 20, keptRate: 0.75, emptyRate: 0.25, wrongRate: 1 / 6, proposedShare: 0.2, cutRate: 0.25, median: '≤ 10 s'});
  assert.equal(medianBucket([0, 0, 0, 0, 0, 3]), '> 80 s');
  assert.equal(ratesOf(undefined).keptRate, null);
});

test('/admin/form-filling shows the answers per family, this week against last', async () => {
  const {d1: STATS} = d1();
  const now = new Date('2026-10-09T12:00:00Z');
  await store({STATS}, {answers: [entry('cli', {kept: 6})]}, 'install-a0001', new Date('2026-10-01T12:00:00Z'));   // last week
  await store({STATS}, {answers: [entry('cli'), entry('codex', {kept: 5})]}, 'install-a0001', now);
  const data = await report(STATS, now);
  assert.equal(data.answers.claude.now.keptRate, 0.8);
  assert.equal(data.answers.claude.before.keptRate, 0.6);
  assert.equal(data.answers.openai.now.keptRate, 0.5);
  const html = page(data);
  assert.match(html, /The AI's answers, by family, this week/);
  assert.match(html, /<td>Claude<\/td><td class="n">2<\/td><td class="n">10<\/td><td class="n">80% <span class="up">/);
  assert.match(html, /<td>OpenAI<\/td>/);
  const section = html.slice(html.indexOf("The AI's answers"), html.indexOf('</section>', html.indexOf("The AI's answers")));
  assert.doesNotMatch(section, /<td>Unknown<\/td>/);   // a family with no calls has no row
});
