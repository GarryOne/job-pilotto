// ↑/↓ in Recent activity open the neighbouring run (renderer/pages/activity.js), skipping runs that only wait.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const source = fs.readFileSync(new URL('../renderer/pages/activity.js', import.meta.url), 'utf8');

test('Recent activity handles ArrowUp/ArrowDown, skips queued rows and keeps the focus on the current row', () => {
  const block = source.slice(source.indexOf("$('activity-recent').addEventListener('keydown'"));
  assert.match(block, /ArrowDown/); assert.match(block, /ArrowUp/);
  assert.match(block, /:not\(\[data-state="queued"\]\)/);
  assert.match(block, /\.recent-row\.current/);
  assert.match(block, /focus\(\)/);
});

test('the Recent activity row builder returns its button (a missing return drew "undefined" rows, 6 Oct 2026)', () => {
  const start = source.indexOf('const recentRow = run =>');
  const end = source.indexOf("$('activity-recent').replaceChildren", start);
  assert.ok(start > 0 && end > start);
  assert.match(source.slice(start, end).trimEnd(), /return button;\s*\};$/);
});
