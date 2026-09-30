// The Recent activity list's grouping: Today / Earlier, and which clock each row shows. A run at 23:59 is today;
// one a minute later is not — the boundary the owner sees when a schedule runs near midnight.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {filterRuns, groupRuns, kindCounts, runTime} from '../renderer/run-list.js';

// Local times on purpose (what the panel compares), so the test means the same in any timezone.
const at = (iso) => ({startedAt: iso, endedAt: iso});
const NOW = new Date(2026, 8, 30, 20, 30);  // Wed 30 Sep 2026, 20:30 local

test('a run from today shows its clock; an older one shows its weekday too', () => {
  assert.equal(runTime(at(new Date(2026, 8, 30, 18, 6).toISOString()), NOW), '18:06');
  assert.match(runTime(at(new Date(2026, 8, 29, 12, 59).toISOString()), NOW), /^[A-Za-z]{3} 12:59$/);
});

test('the day boundary: 23:59 and 00:01 are today, the minute before midnight is Earlier', () => {
  const labels = runs => groupRuns(runs, NOW).map(group => [group.label, group.runs.length]);
  assert.deepEqual(labels([at(new Date(2026, 8, 30, 23, 59).toISOString())]), [['Today', 1]]);
  assert.deepEqual(labels([at(new Date(2026, 8, 30, 0, 1).toISOString())]), [['Today', 1]]);
  assert.deepEqual(labels([at(new Date(2026, 8, 29, 23, 59).toISOString())]), [['Earlier', 1]]);
});

test('a row with no time yet (queued, or just started) is Today, and shows no clock', () => {
  const queued = {waiting: true};
  assert.equal(runTime(queued, NOW), '');
  assert.deepEqual(groupRuns([queued], NOW).map(group => [group.label, group.runs.length]), [['Today', 1]]);
});

test('Today comes first, an empty group is left out, and no run is lost', () => {
  const runs = [at(new Date(2026, 8, 30, 18, 0).toISOString()), at(new Date(2026, 8, 28, 9, 0).toISOString()),
    at(new Date(2026, 8, 30, 7, 0).toISOString())];
  const groups = groupRuns(runs, NOW);
  assert.deepEqual(groups.map(group => group.label), ['Today', 'Earlier']);
  assert.deepEqual(groups.map(group => group.runs.length), [2, 1]);
  assert.equal(groups.flatMap(group => group.runs).length, runs.length);
  assert.deepEqual(groupRuns([], NOW), []);
  assert.deepEqual(groupRuns([at(new Date(2026, 8, 28, 9, 0).toISOString())], NOW).map(group => group.label), ['Earlier']);
});

test('the header\'s filter: the kinds with their counts, most runs first, and what each keeps', () => {
  const runs = [{kind: 'search'}, {kind: 'interviewInsight'}, {kind: 'search'}, {kind: 'mail'}, {kind: 'search'}, {}];
  // A record without a kind counts as the default search, like the rest of the app reads it.
  assert.deepEqual(kindCounts(runs), [
    {kind: 'search', count: 4}, {kind: 'interviewInsight', count: 1}, {kind: 'mail', count: 1}]);
  assert.deepEqual(kindCounts([]), []);
  // '' keeps everything; a kind keeps its own rows.
  assert.equal(filterRuns(runs, '').length, runs.length);
  assert.deepEqual(filterRuns(runs, 'search').map(run => run.kind), ['search', 'search', 'search', undefined]);
  assert.deepEqual(filterRuns(runs, 'mail').map(run => run.kind), ['mail']);
  assert.deepEqual(filterRuns(runs, 'nothing'), []);
});
