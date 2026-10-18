// Changes made against an older read of the Profile land on the right lines after another card's save moved them (renderer/outline-rebase.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {rebaseChanges} from '../renderer/outline-rebase.js';

// This Mac's ids are line numbers: a line added above shifts every id under it.
const lines = texts => texts.map((text, i) => ({id: String(i + 1), type: /^#/.test(text) ? 'heading_2' : 'bulleted_list_item', text: text.replace(/^#\s*/, '')}));
const BEFORE = lines(['# Work eligibility', 'Permit: B', '# Strengths', 'Cloud: AWS', '# Education', 'MSc · ETH', '(confirmed)']);
const NOW = lines(['# Work eligibility', 'Permit: B', 'Visa: none needed', '# Strengths', 'Cloud: AWS', '# Education', 'MSc · ETH', '(confirmed)']);

test('a line moved down by another save: text, remove and insert find it by its words', () => {
  const changes = [{op: 'text', id: '4', value: 'Cloud: AWS, GCP', was: 'Cloud: AWS'}, {op: 'remove', id: '6', was: 'MSc · ETH'}, {op: 'insert', after: '7', lines: ['CKA · CNCF']}];
  assert.deepEqual(rebaseChanges(changes, BEFORE, NOW), [{op: 'text', id: '5', value: 'Cloud: AWS, GCP', was: 'Cloud: AWS'}, {op: 'remove', id: '7', was: 'MSc · ETH'},
    {op: 'insert', after: '8', lines: ['CKA · CNCF']}]);
});

test('ids that did not move stay; a block gone keeps its id (the store refuses it); a section has none', () => {
  assert.deepEqual(rebaseChanges([{op: 'text', id: '2', value: 'Permit: C', was: 'Permit: B'}], BEFORE, NOW)[0].id, '2');
  const gone = lines(['# Work eligibility', 'Permit: B']);
  assert.equal(rebaseChanges([{op: 'insert', after: '7', lines: ['x']}], BEFORE, gone)[0].after, '7');
  const section = {op: 'section', heading: 'Education', lines: ['x']};
  assert.deepEqual(rebaseChanges([section], BEFORE, NOW), [section]);
});

test('two lines with the same words: the one nearest the old place', () => {
  const before = lines(['# A', 'same', '# B', 'same']), now = lines(['# A', 'same', 'new', '# B', 'same']);
  assert.equal(rebaseChanges([{op: 'remove', id: '4', was: 'same'}], before, now)[0].id, '5');
  assert.equal(rebaseChanges([{op: 'remove', id: '2', was: 'same'}], before, now)[0].id, '2');
});

test('Notion: stable ids are kept; a table row is found by its cells', () => {
  const row = (id, ...cells) => ({id, type: 'table_row', cells});
  const before = [{id: 't', type: 'table', rows: [row('r1', 'ETH', 'MSc')]}], now = [{id: 'p', type: 'paragraph', text: 'new'}, {id: 't', type: 'table', rows: [row('r1', 'ETH', 'MSc')]}];
  assert.equal(rebaseChanges([{op: 'cell', id: 'r1', index: 1, value: 'MSc CS', was: 'MSc'}], before, now)[0].id, 'r1');
});
