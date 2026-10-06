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
