// Lab Form Filling's "What we test on" (src/what-we-test.js): the four sets, counted from what CI and the site know, "as of" the commit the repo counts came from; and the upload that carries them.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {data as applyingData} from '../src/applying.js';
import {readReplays, storeReplays} from '../src/applying-replays.js';
import {testSets, whatWeTestSection} from '../src/what-we-test.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const now = new Date('2026-10-15T12:00:00Z');

test('the four sets with their counts and runs; the repo counts come from the newest CI run that sent them, and "as of" names it', () => {
  const runs = [{sha: 'aaaaaaa1', at: '2026-10-13T10:00:00Z', cases: {}, repo: {recorded: 100, zoo: 15}}, {sha: 'bbbbbbb2', at: '2026-10-15T10:00:00Z', cases: {}, repo: {recorded: 111, zoo: 16}}, {sha: 'ccccccc3', at: '2026-10-01T10:00:00Z', cases: {}}];
  const model = testSets({replayRuns: runs.sort((a, b) => a.at.localeCompare(b.at)), pool: [{}, {}, {}], smokeRuns: [{day: '2026-10-14'}, {day: '2026-10-01'}], records: [{recording: {at: 'x'}}, {recording: null}, {recording: {at: 'y'}}], now});
  assert.deepEqual(model.rows.map(row => [row.set, row.count, row.runs]), [['Pool sites (live rows)', 3, 1], ['Saved form pages', 111, 2], ['Control-test pages', 16, null], ['Recorded journeys', 2, null]]);
  assert.deepEqual(model.asOf, {sha: 'bbbbbbb', day: '2026-10-15'});
});

test('before CI has sent the repo counts, they are blank and the section says so; the site\'s own counts still show', () => {
  const model = testSets({replayRuns: [{sha: 'ddddddd4', at: '2026-10-15T10:00:00Z', cases: {}}], pool: [{}], now});
  assert.deepEqual(model.rows.map(row => row.count), [1, null, null, 0]);
  assert.match(whatWeTestSection(testSets({now})), /the repo counts arrive with the next CI run on main/);
  assert.match(whatWeTestSection(model), /as of commit ddddddd, 2026-10-15/);
});

test('the replay upload keeps the repo counts (numbers only, a bad value is dropped) and the lab page carries the section at the top of Coverage', async () => {
  const e = d1();
  await storeReplays(e, {sha: 'abcdef1234567', rows: [{name: 'a', ok: true}], repo: {recorded: 111, zoo: 'many'}}, now);
  assert.deepEqual((await readReplays(e)).at(-1).repo, {recorded: 111, zoo: null});
  const lab = await applyingData(e, now);
  assert.match(lab.whatWeTest, /What we test on/);
  assert.match(lab.whatWeTest, /Saved form pages<\/td><td class="n">111</);
  assert.match(lab.whatWeTest, /as of commit abcdef1/);
  const page = readFileSync(new URL('../src/applying-coverage-view.js', import.meta.url), 'utf8');
  assert.ok(page.indexOf('panels.coverage.append(sets)') > 0 && page.indexOf('panels.coverage.append(sets)') < page.indexOf("panels.coverage.append(el('section', {}, el('h2', {textContent: 'Platform scorecard"), 'the section is the first thing in the Coverage tab, above the Platform scorecard and Next sites to add');
});
