// Every Your details contact field has a kind, and the typed ones are drawn from that table with the hidden input still the one value (owner, 17 Oct 2026).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

install();
const {document} = globalThis;   // the tiny DOM's, installed above
const {LABELS} = await import('../lib/contact.js');
const {CONTACT_KINDS} = await import('../renderer/contact-kinds.js');
const {KINDS} = await import('../renderer/question-kind.js');
const {mountContactControls} = await import('../renderer/contact-controls.js');

test('every contact field in lib/contact.js has a kind, and no kind is for a field that does not exist', () => {
  assert.deepEqual(Object.keys(CONTACT_KINDS).sort(), Object.keys(LABELS).sort());
  for (const [key, spec] of Object.entries(CONTACT_KINDS)) assert.ok(KINDS.includes(spec.kind), key);
});

test('the typed fields are drawn from the table; the input stays the value, in both directions', () => {
  const root = document.createElement('div'), seen = [];
  const inputs = Object.fromEntries(Object.keys(LABELS).map(key => {
    const label = document.createElement('label'), input = document.createElement('input');
    input.dataset.contact = key;
    label.append(key, input);
    root.append(label);
    return [key, input];
  }));
  inputs.salutation.value = 'Madame';
  inputs.salutation.addEventListener('input', () => seen.push(inputs.salutation.value));
  mountContactControls(root);
  const typed = Object.keys(CONTACT_KINDS).filter(key => CONTACT_KINDS[key].kind !== 'text');
  for (const key of typed) assert.equal(inputs[key].hidden, true, `${key} is drawn as its control`);
  for (const key of Object.keys(CONTACT_KINDS).filter(key => !typed.includes(key))) assert.notEqual(inputs[key].hidden, true, `${key} stays a text field`);
  const select = root.children.flatMap(label => label.children).find(node => node.tagName === 'SELECT');
  assert.ok(select, 'the salutation is a pick');
  assert.equal(select.value, 'Madame', 'a salutation in other words stays as a choice: nothing is lost');
  select.value = 'Dr';
  select.dispatch('change');
  assert.equal(inputs.salutation.value, 'Dr');
  assert.deepEqual(seen, ['Dr'], 'the page hears the change as an input on its own field');
  inputs.salutation.value = 'Ms';   // the proposals from the CV set it this way
  const again = root.children.flatMap(label => label.children).find(node => node.tagName === 'SELECT');
  assert.equal(again.value, 'Ms');
  inputs.birth_date.value = '1 December 1990';
  assert.equal(inputs.birth_date.value, '1 December 1990');
});
