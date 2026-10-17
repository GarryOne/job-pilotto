// The pool's life cycle (src/applying-stage.js): one stage per row, nothing deleted; watch and archived are the row's data, the rest derived from what the page computes.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {PAGE, data, ingest} from '../src/applying.js';
import {STAGES, STAGE_WORD, archivable, markStages, stageCounts, stageOf} from '../src/applying-stage.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const run = (extra = {}) => ({needsFix: false, hold: false, reached: 'form', ...extra});
const row = (extra = {}) => ({shape: 'A', name: 'A', status: {state: 'works', rule: ''}, runs: [run(), run(), run()], ...extra});
const confirmed = {site: 'A', status: 'confirmed', cases: [{name: 'page case'}]};

test('every stage is reachable, in the order a row moves through them', () => {
  assert.equal(stageOf(row({runs: [run()]})), 'new');
  assert.equal(stageOf(row({runs: []})), 'new', 'never run = new');
  assert.equal(stageOf(row({status: {state: 'fix'}})), 'fix');
  assert.equal(stageOf(row(), confirmed), 'fixed');
  assert.equal(stageOf(row(), {...confirmed, cases: []}), 'working', 'confirmed without a page case is not frozen yet');
  assert.equal(stageOf(row(), {...confirmed, status: 'landed'}), 'working');
  assert.equal(stageOf(row()), 'working');
  assert.equal(stageOf(row({stageData: 'watch'}), confirmed), 'watch', 'the daily list wins over fixed');
  assert.equal(stageOf(row({stageData: 'archived', status: {state: 'fix'}}), confirmed), 'archived', 'archived wins over everything');
  assert.deepEqual(Object.keys(STAGE_WORD).sort(), [...STAGES].sort(), 'a stage added without its word fails here');
});

test('archivable says why: fixed and frozen, a posting gone twice in a row, or working and clean; never new, failing, watched or archived', () => {
  assert.equal(archivable(row(), confirmed), 'fixed');
  assert.equal(archivable(row()), 'working');
  assert.equal(archivable(row({runs: [run(), run(), run({needsFix: true})]})), null, 'its newest run is short');
  assert.equal(archivable(row({runs: [run(), run()]})), null, 'two clean runs are not three');
  assert.equal(archivable(row({runs: [run()]})), null, 'new');
  const gone = row({status: {state: 'site', rule: 'posting gone'}, runs: [run({needsFix: null, reached: 'none'}), run({needsFix: null, reached: 'none'})]});
  assert.equal(archivable(gone), 'posting-gone');
  assert.equal(archivable({...gone, runs: [run({needsFix: null, reached: 'none'})]}), null, 'once is a bad moment');
  assert.equal(archivable({...gone, status: {state: 'site', rule: 'site refused'}}), null, 'a refusing site is not a gone posting');
  assert.equal(archivable(row({stageData: 'watch'}), confirmed), null);
  assert.equal(archivable(row({stageData: 'archived'}), confirmed), null);
  assert.equal(archivable(row({status: {state: 'fix'}}), confirmed), null);
});

test('markStages marks every row and counts only stages that hold one', () => {
  const pool = [row({shape: 'A', name: 'A'}), row({shape: 'B', name: 'B', status: {state: 'fix'}}), row({shape: 'C', name: 'C', runs: [run()]}), row({shape: 'D', name: 'D', stageData: 'archived'})];
  markStages(pool, [confirmed]);
  assert.deepEqual(pool.map(item => item.stage), ['fixed', 'fix', 'new', 'archived']);
  assert.deepEqual(stageCounts(pool).map(item => [item.name, item.sites]), [['fix', 1], ['new', 1], ['fixed', 1], ['archived', 1]]);
});

test('the pool upload carries a row\'s stage; fixed words only; the row\'s stage is its latest upload', async () => {
  const db = d1(), now = new Date('2026-10-17T12:00:00Z');
  await ingest(db, {kind: 'pool', day: '2026-10-17', version: '1', rows: [{name: 'Old posting', start_host: 'a.example.com', stage: 'archived', stage_why: 'posting-gone'}, {name: 'Watched', start_host: 'b.example.com', stage: 'watch', stage_why: 'fixed'},
    {name: 'Odd', start_host: 'c.example.com', stage: 'deleted', stage_why: 'because'}, {name: 'Plain', start_host: 'd.example.com'}]}, now);
  const stored = Object.fromEntries(db.db.prepare('SELECT name, stage, stage_why FROM applying_pool').all().map(item => [item.name, [item.stage, item.stage_why]]));
  assert.deepEqual({...stored}, {'Old posting': ['archived', 'posting-gone'], Watched: ['watch', null], Odd: [null, null], Plain: [null, null]});
  await ingest(db, {kind: 'pool', day: '2026-10-17', version: '1', rows: [{name: 'Old posting', start_host: 'a.example.com'}]}, now);
  assert.deepEqual({...db.db.prepare('SELECT stage, stage_why FROM applying_pool WHERE name = ?').get('Old posting')}, {stage: null, stage_why: null}, 'unarchived by the next upload');
  const page = await data(db, now);
  assert.deepEqual(page.pool.map(item => [item.shape, item.stage]).sort(), [['Odd', 'new'], ['Old posting', 'new'], ['Plain', 'new'], ['Watched', 'watch']]);
  assert.deepEqual(page.stageWords, STAGE_WORD);
  assert.ok(page.stages.every(item => item.sites > 0));
});

test('the Sites tab hides archived rows by default and brings them back by the Stage chip or a search; the site cell names the stage', () => {
  assert.match(PAGE, /const stageMatch = \(s, c\) => \(c\.stage \? s\.stage === c\.stage : s\.stage !== 'archived' \|\| Boolean\(c\.query\)\)/);
  assert.match(PAGE, /chipFilter\('Stage', \[\['', 'Active'\]/);
  assert.match(PAGE, /d\.stageWords \|\| \{\}\)\[s\.stage\]/);
});
