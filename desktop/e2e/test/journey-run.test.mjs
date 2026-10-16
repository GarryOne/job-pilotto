// journeys.json names real pool rows, and a journey with no record is red, not skipped (journey-run.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {journeyRows, plan} from '../journey-run.mjs';

test('every journey says why it is here and names its row once', () => {
  const rows = journeyRows();
  assert.ok(rows.length >= 3);
  for (const one of rows) assert.ok(one.pending || one.marks?.length, `${one.row}: neither blessed marks (until its log carries page lines) nor a pending reason`);
  assert.equal(new Set(rows.map(one => one.row)).size, rows.length);
  for (const one of rows) assert.ok(one.row && one.why, JSON.stringify(one));
});

test('a row with a record is run from it; a row without one is reported missing', () => {
  const rows = [{row: 'A', why: 'x'}, {row: 'B', why: 'y'}];
  assert.deepEqual(plan(rows, [{name: 'A', dir: '/r/a'}]), {pending: [], run: [{row: 'A', why: 'x', dir: '/r/a'}], missing: ['B']});
  assert.deepEqual(plan(rows, [{name: 'A', dir: '/r/a'}], 'B'), {pending: [], run: [], missing: ['B']});
  assert.deepEqual(plan([{row: 'C', pending: 'later'}], []), {pending: [{row: 'C', pending: 'later'}], run: [], missing: []});
});

test('the PR workflow has one runner per journey that is not pending', () => {
  const text = fs.readFileSync(new URL('../../../.github/workflows/journeys-pr.yml', import.meta.url), 'utf8');
  const listed = JSON.parse(/row: (\[.*?\])\s/.exec(text.replace(/'/g, '"'))[1]);
  assert.deepEqual(listed, journeyRows().filter(one => !one.pending).map(one => one.row));
});
