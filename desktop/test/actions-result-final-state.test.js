// 18 Oct 2026: a finished run's card on Actions stayed skeleton bars for ever (no result on its page). Skeleton bars mean a read is in flight; every other end is a final card.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {activitySource} from './activity-source.js';

const body = () => { const s = activitySource(); return s.slice(s.indexOf('export function showAwaitedResult'), s.indexOf('// The status bar')); };

test('a result read that ends with no message draws the no-result card with a next step and Log, never skeleton bars', () => {
  const awaited = body();
  assert.match(awaited, /renderNoResult\(head, \{log: /);
  assert.match(awaited, /log: \(\) => \{ shared\.selectedRun = run\.id; openActivity\(true\); \}/);
  assert.match(awaited, /head\.fix\?\.retry \? \(\) => load\(\)/, 'Retry (Read again) runs the same read');
  assert.equal((awaited.match(/renderCardSkeleton/g) || []).length, 1, 'the skeleton is drawn once, inside load()');
  assert.ok(awaited.indexOf('renderCardSkeleton') < awaited.indexOf('read().then'), 'only before the read starts');
});

test('a throw while drawing the result is drawn again as the no-result card, and a rejected read is logged', () => {
  const awaited = body();
  assert.match(awaited, /try \{ show\(message \|\| null\); \} catch \(error\) \{[^}]*show\(null\); \}/);
  assert.match(awaited, /\.catch\(error => \{ console\.error\('actions: a result card was not drawn', error\); waitingForResult\.delete\(run\.id\); \}\)/);
});

test('the no-result card says so in plain words', () => {
  assert.match(fs.readFileSync(new URL('../renderer/run-status.js', import.meta.url), 'utf8'), /Its result was not saved/);
});
