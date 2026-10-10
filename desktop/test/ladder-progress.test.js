// The ladder's progress report (tools/ladder-progress.mjs): a bar is boxes ticked over boxes in the spec's "## Progress" checklist, nothing estimated.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {bar, progressOf, report} from '../../tools/ladder-progress.mjs';

const SPEC = '# t\n\n## Design\n- [ ] not counted\n\n## Progress (x)\n### A. First\n- [x] one\n- [ ] two\n### B. Second\n- [x] a\n- [x] b\n## Other\n- [ ] not counted\n';

test('each item counts its own boxes, and nothing outside the Progress section', () => {
  assert.deepEqual(progressOf(SPEC), [{title: 'A. First', done: 1, total: 2}, {title: 'B. Second', done: 2, total: 2}]);
  assert.deepEqual(progressOf('no checklist here'), []);
});
test('a bar is filled by the share done, full only when everything is', () => {
  assert.equal(bar(0, 4, 8), '[░░░░░░░░]');
  assert.equal(bar(2, 4, 8), '[████░░░░]');
  assert.equal(bar(4, 4, 8), '[████████]');
  assert.match(report(progressOf(SPEC)), /75%  3\/4  THE LADDER/);
});
test('the real spec has a checklist, so the report is never empty', () => {
  const items = progressOf(fs.readFileSync(new URL('../../docs/superpowers/specs/2026-10-10-ai-ladder.md', import.meta.url), 'utf8'));
  assert.ok(items.length >= 6 && items.every(item => item.total > 0));
});
