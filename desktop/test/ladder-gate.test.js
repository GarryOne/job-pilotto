// The ladder gate (tools/ladder-gate.mjs): which pushes replay the fixtures offline against the baseline.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {touchedLadderFiles} from '../../tools/ladder-gate.mjs';

const FLOW = ['extension/fill-flow.js', 'desktop/lib/page-kind.js'];

test('a flow file, the page-kind decision, the fixtures or the baseline start the ladder gate; other files do not', () => {
  assert.deepEqual(touchedLadderFiles(['extension/fill-flow.js', 'README.md'], FLOW), ['extension/fill-flow.js']);
  assert.deepEqual(touchedLadderFiles(['desktop/lib/page-kind.js'], FLOW), ['desktop/lib/page-kind.js']);
  assert.deepEqual(touchedLadderFiles(['desktop/e2e/ladder-fixtures/aldi-suisse.json', 'desktop/e2e/ladder-baseline.json', 'desktop/e2e/lib/ladder-score.mjs'], FLOW).length, 3);
  assert.deepEqual(touchedLadderFiles(['desktop/renderer/pages/jobs.js', 'site/src/x.js'], FLOW), []);
});
