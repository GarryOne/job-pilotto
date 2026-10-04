// The stacked Recent activity panel (narrow window) scrolls as one area, not as two nested panes.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const css = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'renderer', 'style.css'), 'utf8');

test('stacked activity panel has a single scroll area', () => {
  const rule = css.split('\n').find(l => l.startsWith('@media (max-width: 1180px)') && l.includes('.activity-panel .ap-grid'));
  assert.ok(rule, 'stacked media rule exists');
  assert.match(rule, /\.activity-panel \.ap-grid[^}]*overflow-y: auto/);
  assert.match(rule, /\.activity-panel \.ap-list[^}]*overflow: visible/);
  assert.match(rule, /\.activity-panel \.ap-detail[^}]*overflow: visible/);
});
