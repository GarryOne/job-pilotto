// The card shell (renderer/card-shell.js; owner, 18 Oct 2026, UI redesign): read rows with "Not set" and notes under values, chips on one line, aligned editor
// rows, and the editing state that hides Edit (CSS) and opens a folded card.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

install();
const {readRows, chipLine, editRows, setEditing, isEditing} = await import('../renderer/card-shell.js');
const {el} = await import('../renderer/components.js');

test('read rows: label → value, a missing value is a "Not set" pill, a note sits under its value, missing:"" skips the row', () => {
  const list = readRows([{label: 'Email', value: 'alex@example.com'}, {label: 'Phone', value: ''}, {label: 'Notice', value: '1 month', note: 'ends at month-end'},
    {label: 'Street', value: '', missing: ''}]);
  assert.equal(list.className, 'summary-rows is-compact');
  assert.deepEqual(list.querySelectorAll('dt').map(node => node.textContent), ['Email', 'Phone', 'Notice']);
  const [, phone, notice] = list.querySelectorAll('dd');
  assert.equal(phone.querySelector('.pill')?.textContent ?? phone.textContent, 'Not set');
  assert.equal(notice.querySelector('.read-note').textContent, 'ends at month-end');
});

test('chips on one line, with a detail', () => {
  const line = chipLine([{text: 'English', detail: 'B2'}, 'Romanian']);
  assert.equal(line.className, 'read-values');
  assert.equal(line.children.length, 2);
});

test('editor rows: one label column, the control beside it', () => {
  const box = editRows([{label: 'Email', control: el('input')}, {label: 'Phone', control: el('input'), hint: 'with the country code'}]);
  assert.equal(box.className, 'edit-rows');
  assert.deepEqual(box.querySelectorAll('.edit-label').map(node => node.textContent), ['Email', 'Phone']);
  assert.equal(box.querySelectorAll('.edit-control input').length, 2);
});

test('editing: the card is marked, a folded <details> card opens, and the CSS hides Edit and swaps read for editor', () => {
  const card = el('details');
  card.open = false;
  setEditing(card, true);
  assert.equal(isEditing(card), true);
  assert.equal(card.open, true);
  setEditing(card, false);
  assert.equal(isEditing(card), false);
  const css = fs.readFileSync(new URL('../renderer/card-shell.css', import.meta.url), 'utf8');
  for (const rule of ['.is-editing .card-edit { display: none; }', '.is-editing .card-editor { display: block; }', '.is-editing .card-read { display: none; }']) assert.ok(css.includes(rule), rule);
  for (const page of ['index.html', 'gallery.html']) assert.match(fs.readFileSync(new URL(`../renderer/${page}`, import.meta.url), 'utf8'), /href="card-shell\.css"/, page);
});
