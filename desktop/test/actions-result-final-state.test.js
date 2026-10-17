// 18 Oct 2026: a finished run's card on Actions stayed skeleton bars for ever (no result on its page). Skeleton bars mean a read is in flight; every other end is a final card.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {activitySource} from './activity-source.js';

const body = () => { const s = activitySource(); return s.slice(s.indexOf('export function showAwaitedResult'), s.indexOf('// The status bar')); };

test('a result read that ends with no message draws the no-result card with Retry and Log, never skeleton bars', () => {
  const awaited = body();
  assert.match(awaited, /renderNoResult\(capital\(outcome\(run\)\), \{retry: \(\) => load\(\),/);
  assert.match(awaited, /log: \(\) => \{ shared\.selectedRun = run\.id; openActivity\(true\); \}/);
  assert.equal((awaited.match(/renderCardSkeleton/g) || []).length, 1, 'the skeleton is drawn once, inside load()');
  assert.ok(awaited.indexOf('renderCardSkeleton') < awaited.indexOf('read().then'), 'only before the read starts');
});

test('a throw while drawing the result is drawn again as the no-result card, and a rejected read is logged', () => {
  const awaited = body();
  assert.match(awaited, /try \{ show\(message \|\| null\); \} catch \(error\) \{[^}]*show\(null\); \}/);
  assert.match(awaited, /\.catch\(error => \{ console\.error\('actions: a result card was not drawn', error\); waitingForResult\.delete\(run\.id\); \}\)/);
});

test('the no-result card says so in plain words', () => {
  assert.match(activitySource(), /No result was saved for this run\./);
});
