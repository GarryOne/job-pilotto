// The gaps between a pool row's progress notes (lib/pool-gaps.mjs; spec 2026-10-12-one-next-move.md phase 2 box 2): the silent dead-end rule's T is read from them, so the
// parser must take exactly the extension's "progress: <kind>" lines, the time between them in any tab of the application, and the silence after the last note.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {appLogName, gapRows, gapSummary, progressOf, quantile, rowGaps} from '../lib/pool-gaps.mjs';
import {PROGRESS_KINDS} from '../../../extension/ladder/progress.js';

const line = (at, text) => `2026-10-13T00:00:${String(at).padStart(2, '0')}.000Z ${text}`;
const log = [
  line(0, '[extension] fill: page kind: posting {"by":"ai","host":"jobs.example","version":"0.9.256"}'),
  line(1, '[extension] fill: progress: navigated {"host":"jobs.example","version":"0.9.256"}'),
  line(3, '[extension] fill: pressed the Apply button {"host":"jobs.example","version":"0.9.256"}'),
  line(5, '[extension] fill: progress: navigated {"host":"apply.example","version":"0.9.256"}'),
  line(9, '[extension] fill: progress: required_down {"filled":3,"host":"jobs.example","sinceMs":4000,"version":"0.9.256"}'),
  line(12, '[extension] fill: progress: clicked {"sinceMs":3000}'),
  line(30, '[extension] fill: dead end: other {"ending":"unresolved","named":false}'),
  line(40, '[store] agent_runs.add {"exit":0}'),
].join('\n');

test('only the extension\'s progress lines of a listed kind count', () => {
  assert.deepEqual(progressOf(log), [
    {at: Date.parse('2026-10-13T00:00:01.000Z'), kind: 'navigated'},
    {at: Date.parse('2026-10-13T00:00:05.000Z'), kind: 'navigated'},
    {at: Date.parse('2026-10-13T00:00:09.000Z'), kind: 'required_down'}]);
  assert.deepEqual(progressOf(`${line(1, '[app] fill: progress: navigated {}')}\nnot a line`), [], 'another source, or no time, is not progress');
  assert.ok(['navigated', 'required_down'].every(kind => PROGRESS_KINDS.includes(kind)), 'the kinds the test writes are the extension\'s own');
});

test('a row is one application: its gaps (wall-clock between notes in any tab, so a new tab never leaves the posting tab "silent"), the slowest, the silence after the last note to the log\'s end, and whether the door already spoke', () => {
  assert.deepEqual(rowGaps(log), {events: 3, gaps: [{ms: 4000, kind: 'navigated'}, {ms: 4000, kind: 'required_down'}], maxGapMs: 4000, tailMs: 31000, deadEnd: true});
  assert.deepEqual(rowGaps(line(0, '[extension] fill: page kind: other {}')), {events: 0, gaps: [], maxGapMs: 0, tailMs: null, deadEnd: false}, 'a build without progress notes is not measured');
});

test('one row per row the run ran, with its ending; the summary: quantiles of every gap, the slowest on rows that reached the form, rows not measured', () => {
  const report = {day: '2026-10-13', thisRun: {ran: ['A', 'B', 'C']}, results: {A: {reached: 'form', ending: 'ready'}, B: {reached: 'account', ending: 'unresolved'}, C: {ending: 'held'}, Old: {ending: 'ready'}}};
  const slow = [line(0, '[extension] fill: progress: navigated {}'), line(20, '[extension] fill: progress: new_controls {"sinceMs":20000}')].join('\n');
  const rows = gapRows(report, {A: log, B: slow, Old: log});
  assert.deepEqual(rows.map(row => [row.row, row.ending, row.maxGapMs, row.measured]), [['A', 'ready', 4000, true], ['B', 'unresolved', 20000, true], ['C', 'held', 0, false]]);
  assert.deepEqual(gapSummary(rows), {measured: 2, notMeasured: 1, gaps: 3, p50: 4000, p90: 20000, p95: 20000, p99: 20000, max: 20000, maxReady: 4000});
  assert.equal(quantile([], 0.5), null);
  assert.equal(quantile([1000, 2000, 3000, 4000], 0.5), 3000);
});

test('a row\'s app log is found by the name smoke.mjs writes it under', () => {
  assert.equal(appLogName('2026-10-13', 'arbeitnow.ch board -> employer'), '2026-10-13-arbeitnow-ch-board-employer.app.log');
  const smoke = fs.readFileSync(new URL('../smoke.mjs', import.meta.url), 'utf8');
  assert.match(smoke, /`\$\{day\}-\$\{shape\.replace\(\/\\W\+\/g, '-'\)\}\.app\.log`/, 'smoke.mjs renamed its app log: change appLogName with it');
});
