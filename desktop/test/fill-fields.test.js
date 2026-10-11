// The fill's logged field rows carry `required`, so the smoke report never counts an optional field left empty as a failure (11 Oct 2026, Datadog: "Website").
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {loggedFields} from '../../extension/fill-fields.js';
import {fieldLines} from '../e2e/lib/smoke.mjs';

const TRACE = [
  {label: 'First Name', type: 'text', required: true, outcome: 'filled', source: 'your details', reason: ''},
  {label: 'Website', type: 'text', required: false, outcome: 'left', source: '', reason: 'a detail of yours not saved yet (website)'},
];

test('the logged fill line says which fields are required and which are optional', () => {
  const rows = loggedFields(TRACE);
  assert.deepEqual(rows.map(row => [row.label, row.required]), [['First Name', true], ['Website', false]]);
  const line = `00:22:09 [extension] fill: fields: 1 filled, 1 left {"fields":${JSON.stringify(rows)}}`;
  assert.deepEqual(fieldLines(line).map(text => text.match(/required=(\S+)/)[1]), ['true', 'false']);
});

test('background.js logs the fill line through loggedFields, never its own copy of the rows', () => {
  const source = fs.readFileSync(new URL('../../extension/background.js', import.meta.url), 'utf8');
  assert.match(source, /const fields = loggedFields\(result\.trace\)/);
});
