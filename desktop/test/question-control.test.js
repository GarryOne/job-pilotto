// The answer control matches the question's kind (owner, 17 Oct 2026: a checkbox, a single choice and dropdowns were all drawn as text boxes).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

install();
const {answerControl, kindPicker} = await import('../renderer/question-control.js');
const {formatFor} = await import('../renderer/question-kind.js');
const click = node => node.listeners.click?.forEach(fn => fn({preventDefault() {}}));
const fire = (node, type) => node.listeners[type]?.forEach(fn => fn({}));
const texts = node => node.children.map(child => child.textContent);

test('each kind draws its control', () => {
  const draw = format => answerControl(formatFor({marked: format}), '', () => {});
  assert.equal(draw(null).tagName, 'INPUT');
  assert.equal(draw({kind: 'long_text'}).tagName, 'TEXTAREA');
  const yesNo = draw({kind: 'yes_no'});
  assert.ok(yesNo.className.includes('segmented'));
  assert.deepEqual(texts(yesNo), ['Yes', 'No']);
  const title = draw({kind: 'single', options: ['Mr', 'Mrs', 'Ms']});
  assert.ok(title.className.includes('segmented'), 'a few short options: one click');
  const permit = draw({kind: 'single', options: ['Swiss citizen', 'EU/EFTA citizen', 'C permit', 'B permit', 'None of these']});
  assert.equal(permit.tagName, 'SELECT');
  assert.deepEqual(texts(permit), ['Choose…', 'Swiss citizen', 'EU/EFTA citizen', 'C permit', 'B permit', 'None of these']);
  const country = draw({kind: 'single', list: 'countries'});
  assert.equal(country.tagName, 'SELECT');
  assert.ok(texts(country).includes('Switzerland'));
  assert.equal(draw({kind: 'single', options: []}).tagName, 'INPUT', 'a choice with no known options is typed');
  assert.equal(draw({kind: 'multi', options: ['English', 'German']}).dataset.answerKind, 'multi');
});

test('Yes / No gives the meaning, and a second press clears it', () => {
  const seen = [];
  const node = answerControl(formatFor({marked: {kind: 'yes_no'}}), '', value => seen.push(value));
  click(node.children[0]);
  assert.equal(node.value, 'Yes');
  assert.ok(node.children[0].className.includes('is-active'));
  click(node.children[0]);
  assert.deepEqual(seen, ['Yes', '']);
});

test('several picks become one line', () => {
  const seen = [];
  const node = answerControl(formatFor({marked: {kind: 'multi', options: ['English', 'German', 'French']}}), 'English', value => seen.push(value));
  click(node.children[2]);
  click(node.children[0]);
  assert.deepEqual(seen, ['English, French', 'French']);
});

test('a menu keeps an answer saved in other words', () => {
  const node = answerControl(formatFor({marked: {kind: 'single', options: ['Swiss citizen', 'EU/EFTA citizen', 'C permit', 'B permit']}}), 'EU citizen, B permit', () => {});
  assert.ok(texts(node).includes('EU citizen, B permit'));
});

test('the person can change a question\'s kind', () => {
  const picked = [];
  const node = kindPicker('single', kind => picked.push(kind));
  assert.equal(node.value, 'single');
  node.value = 'yes_no';
  fire(node, 'change');
  assert.deepEqual(picked, ['yes_no']);
});
