// Recent activity draws one selected row, even when two records share an id (21 Oct 2026: two Find jobs rows were selected at once).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

test('the selected row is the one run object, not every row with its id', () => {
  const source = fs.readFileSync(new URL('../renderer/pages/activity-render.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /run\.id === shown\.id/, 'selecting by id marks every row that shares it');
  assert.match(source, /run === shown/, 'the row is selected by identity');
});
