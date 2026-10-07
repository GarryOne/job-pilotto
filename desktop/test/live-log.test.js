// Reopening Recent activity (or ⌘R) during a search keeps its Technical log: the app's copy re-seeds the window's (7 Oct 2026).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {seeded} from '../renderer/live-log.js';

test("the app's longer copy replaces the window's cleared list; the window's newer lines are kept otherwise", () => {
  const app = ['Searching job boards…', 'Checked: Manor AG', '⏳ Reading new jobs with AI: 3 of 26'];
  assert.deepEqual(seeded(app, ['⏳ Still running · no new output for 4 min']), app);
  const newer = [...app, '⏳ Reading new jobs with AI: 9 of 26'];
  assert.equal(seeded(app, newer), newer);
  assert.deepEqual(seeded(undefined, ['x']), ['x']);
});

test('every fresh activity read re-seeds the live log while a task runs', () => {
  const source = fs.readFileSync(new URL('../renderer/pages/activity.js', import.meta.url), 'utf8');
  assert.match(source, /if \(!running\) shared\.idleSeen = true;\n  else shared\.logLines = seeded\(running\.log, shared\.logLines\);/);
});
