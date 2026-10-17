// A Your details line draws the control of its kind and gives back its value and kind (owner, 17 Oct 2026: "Base facts fixed"); a line the kind cannot read
// stays as written with a "Check" chip, and a plain line is the text box it always was.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

install();
const {factRow, factOf} = await import('../renderer/fact-line.js');
const fire = (node, type) => node.listeners[type]?.forEach(fn => fn({}));

test('a marked line draws its kind\'s control and reads back as value + kind', () => {
  const dirty = [];
  const row = factRow('availability', {label: 'Notice period', value: '3 months', kind: 'duration'}, {}, () => dirty.push(1));
  assert.equal(row.dataset.kind, 'duration');
  assert.deepEqual(factOf(row), {label: 'Notice period', value: '3 months', kind: 'duration'});
  const number = row.all().find(node => node.tagName === 'INPUT' && node.type === 'number');
  number.value = '2';
  fire(number, 'input');
  assert.deepEqual(factOf(row), {label: 'Notice period', value: '2 months', kind: 'duration'});
  assert.equal(dirty.length, 1, 'an edit marks the one Save bar');
});

test('a kind judged for the label (not yet marked) draws too, and is written as the line\'s mark on save', () => {
  const formats = {'notice period': {kind: 'duration', options: []}};
  const row = factRow('availability', {label: 'Notice period', value: '3 months'}, formats, () => {});
  assert.equal(factOf(row).kind, 'duration');
});

test('a line the kind cannot read stays as written, with a Check chip; a plain line has none', () => {
  const odd = factRow('availability', {label: 'Salary', value: 'CHF 140,000 a year', kind: 'salary'}, {}, () => {});
  assert.equal(factOf(odd).value, 'CHF 140,000 a year', 'nothing lost');
  assert.ok(odd.all().some(node => node.textContent === 'Check'));
  const plain = factRow('availability', {label: 'Mood', value: 'good'}, {}, () => {});
  assert.equal(plain.all().some(node => node.textContent === 'Check'), false);
  assert.deepEqual(factOf(plain), {label: 'Mood', value: 'good', kind: ''});
});

test('a new line is named by the person and starts as text', () => {
  const row = factRow('languages', {}, {}, () => {});
  const name = row.all().find(node => node.dataset.factLabel);
  name.value = 'Spanish';
  const value = row.all().find(node => node.tagName === 'INPUT' && node.type === 'text' && !node.dataset.factLabel);
  value.value = 'native';
  fire(value, 'input');
  assert.deepEqual(factOf(row), {label: 'Spanish', value: 'native', kind: ''});
});
