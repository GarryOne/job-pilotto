// ↑/↓ in Recent activity open the neighbouring run (renderer/pages/activity.js), skipping runs that only wait.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {activitySource} from './activity-source.js';

const source = activitySource();

test('Recent activity handles ArrowUp/ArrowDown from the current row, not from the focus, and skips queued rows', () => {
  const block = source.slice(source.indexOf("document.addEventListener('keydown', event => {\n    if (event.key !== 'ArrowDown'"));
  assert.match(block, /ArrowDown/); assert.match(block, /ArrowUp/);
  assert.match(block, /:not\(\[data-state="queued"\]\)/);
  assert.match(block, /classList\.contains\('current'\)/);
  assert.match(block, /\$\('activity-panel'\)\.hidden/);
  assert.match(block, /input, textarea, select/);   // typing keeps its own arrows
});

test('the Recent activity row builder returns its button (a missing return drew "undefined" rows, 6 Oct 2026)', () => {
  const start = source.indexOf('const recentRow = run =>');
  const end = source.indexOf('// Every redraw', start);
  assert.ok(start > 0 && end > start);
  assert.match(source.slice(start, end).trimEnd(), /return button;\s*\};$/);
});
