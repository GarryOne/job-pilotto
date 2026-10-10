// Metrics by AI family, installs by engine (src/engines.js; migration 0044): owner, 9 Oct 2026.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {familyOf, familyOfInstall, installsByEngine} from '../src/engines.js';
import {store} from '../src/knowledge.js';
import {page, report} from '../src/formlearning.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0002_telemetry.sql', '0004_recipes.sql', '0005_lab.sql', '0006_exposure.sql', '0009_knowledge.sql', '0017_alias_proposals.sql',
    '0022_form_required.sql', '0044_family_counts.sql']) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args) ?? null});
  return {db, d1: {prepare: sql => statement(sql)}};
}
const health = (db, install, aiEngine, at = '2026-10-09T10:00:00Z') => db.prepare(`INSERT INTO telemetry (day, at, kind, install, version, platform, fingerprint, summary, data)
  VALUES (?, ?, 'health', ?, '0.6.0', 'darwin', 'health', 'health', ?)`).run(at.slice(0, 10), at, install, JSON.stringify({aiEngine}));

test('a family per engine: the CLI and the API key of a family run the same models', () => {
  assert.deepEqual(['api', 'cli', 'openai', 'codex', 'none', undefined].map(familyOf), ['claude', 'claude', 'openai', 'openai', 'unknown', 'unknown']);
});

test("an install's family is its latest health report's; none yet is unknown", async () => {
  const {db, d1: STATS} = d1();
  health(db, 'install-aaaa1', 'cli', '2026-10-08T10:00:00Z');
  health(db, 'install-aaaa1', 'codex', '2026-10-09T10:00:00Z');   // switched to Codex: the latest counts
  assert.equal(await familyOfInstall(STATS, 'install-aaaa1'), 'openai');
  assert.equal(await familyOfInstall(STATS, 'install-nohealth'), 'unknown');
});

test('installs are counted by their four engines (plan vs API), the rest as not reported yet', async () => {
  const {db, d1: STATS} = d1();
  health(db, 'install-a0001', 'cli'); health(db, 'install-a0002', 'cli'); health(db, 'install-a0003', 'api');
  health(db, 'install-a0004', 'codex'); health(db, 'install-a0005', 'openai'); health(db, 'install-a0006', 'none');
  const counts = Object.fromEntries((await installsByEngine(STATS, '2026-10-01')).map(row => [row.engine, row.n]));
  assert.deepEqual(counts, {api: 1, cli: 2, openai: 1, codex: 1, unknown: 1});
});

test('a Codex install\'s form results land in the OpenAI row and under the OpenAI filter, never in Claude\'s', async () => {
  const {db, d1: STATS} = d1();
  health(db, 'install-codex1', 'codex'); health(db, 'install-claud1', 'cli');
  const now = new Date('2026-10-09T12:00:00Z');
  await store({STATS}, {flows: [{board: 'greenhouse', state: 'submitted-clean', n: 3}], unfilled: [{board: 'greenhouse', reason: 'no_answer', n: 2}]}, 'install-codex1', now);
  await store({STATS}, {flows: [{board: 'greenhouse', state: 'failed-no-form', n: 1}]}, 'install-claud1', now);
  const families = db.prepare('SELECT ai_family, state, n FROM flow_outcomes ORDER BY ai_family').all().map(row => [row.ai_family, row.state, row.n]);
  assert.deepEqual(families, [['claude', 'failed-no-form', 1], ['openai', 'submitted-clean', 3]]);
  const openai = await report(STATS, now, 'openai');
  assert.equal(openai.results.now.submitted, 3);
  assert.equal(openai.results.now.failed, 0);   // the Claude install's failure is not counted under OpenAI
  const all = await report(STATS, now);
  assert.equal(all.results.now.finished, 4);
  assert.deepEqual([all.families.openai.successRate, all.families.claude.successRate], [1, 0]);
  const html = page(all, new URL('https://www.jobpilotto.top/admin/form-filling'));
  assert.match(html, /By AI family, this week/);
  assert.match(html, /href="\/admin\/form-filling\?family=openai"/);
});
