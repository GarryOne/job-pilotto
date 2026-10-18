// Profile → Experience's editors on the Profile's one save bar (renderer/experience-editors.js, pages/experience-profile.js; owner, 18 Oct 2026): no card
// saves on its own; opening an editor and saving with no change writes nothing; Strengths edit as chips; an Education line not in the app's shape stays
// as written until Organize into fields; every open card's changes go out in ONE write (on this Mac a line's id is its place).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

const body = install();
const PROFILE = [
  {id: 'h1', type: 'heading_1', text: 'Summary (from CV)'}, {id: 's1', type: 'paragraph', text: 'SRE with 8 years on AWS.'},
  {id: 'h2', type: 'heading_1', text: 'Strengths'},
  {id: 'k1', type: 'bulleted_list_item', text: '**Cloud:** AWS in depth (EKS, RDS); some GCP'}, {id: 'k2', type: 'bulleted_list_item', text: '**IaC:** Terraform, Helm'},
  {id: 'h3', type: 'heading_1', text: 'Education'},
  {id: 'e1', type: 'bulleted_list_item', text: 'MSc Computer Science, Example Technical University'}, {id: 'e2', type: 'bulleted_list_item', text: '(confirmed 2 Oct 2026)'},
];
const sent = [];
let refuse = false;
let outline = PROFILE;   // what a fresh read returns now
globalThis.window.pilot = new Proxy({textOutline: async () => ({ok: true, items: outline, store: 'sqlite'}),
  textEdit: async (name, changes) => { sent.push([name, changes]); return refuse ? {ok: false, error: 'Some lines changed meanwhile', items: PROFILE} : {ok: true, items: PROFILE}; }}, {get: (all, key) => all[key] || (() => null)});
const page = await import('../renderer/pages/experience-profile.js');
const {profileBar} = await import('../renderer/pages/profile-save-bar.js');

async function open() {
  sent.length = 0;
  profileBar().discardAll({ask: false});
  const node = globalThis.document.createElement('div');
  node.id = 'exp-profile';
  body.replaceChildren(node);
  await page.loadExperienceProfile('experience');
  return node;
}
const cardOf = (node, key) => node.querySelectorAll('details.qa-fold').find(each => each.dataset.part === key);
const edit = (node, key) => cardOf(node, key).querySelector('button.card-edit').listeners.click[0]({preventDefault() {}});
const type = (input, value) => { input.value = value; input.dispatch('input'); };

test('class: every card on the tab opens its editor with no Save, Cancel or Discard; open and save with no change writes nothing', async () => {
  const node = await open();
  const keys = node.querySelectorAll('details.qa-fold').map(card => card.dataset.part);
  assert.deepEqual(keys, ['summary', 'strengths', 'education']);
  for (const key of keys) {
    edit(node, key);
    const card = cardOf(node, key);
    assert.ok(card.classList.contains('is-editing'), `${key}: the card is in its editor`);
    const words = card.querySelectorAll('button').map(button => button.textContent);
    assert.ok(!words.some(word => /^(Save|Cancel|Discard)/.test(word)), `${key}: ${words}`);
  }
  assert.equal(profileBar().count(), 0, 'nothing changed: no draft');
  await profileBar().saveAll();
  assert.deepEqual(sent, []);
});

test('Strengths: values as chips; a chip removed and one added is one change of that line', async () => {
  const node = await open();
  edit(node, 'strengths');
  const card = cardOf(node, 'strengths');
  assert.deepEqual(card.querySelectorAll('.chip-value').map(each => each.textContent), ['AWS in depth (EKS, RDS)', 'some GCP', 'Terraform', 'Helm']);
  card.querySelectorAll('button.x').find(button => button.getAttribute('aria-label') === 'Remove some GCP').listeners.click[0]({preventDefault() {}});
  const add = cardOf(node, 'strengths').querySelectorAll('input.add')[0];
  add.value = 'Azure';
  add.listeners.keydown[0]({key: 'Enter', preventDefault() {}});
  assert.equal(profileBar().count(), 1);
  await profileBar().saveAll();
  assert.deepEqual(sent, [['profile', [{op: 'text', id: 'k1', value: '**Cloud:** AWS in depth (EKS, RDS), Azure', was: PROFILE[3].text}]]]);
  assert.ok(!cardOf(node, 'strengths').classList.contains('is-editing'), 'back to the read view after the save');
});

test('Education: a line not in the app\'s shape is kept as written; Organize into fields, then the fields are written', async () => {
  const node = await open();
  edit(node, 'education');
  let card = cardOf(node, 'education');
  assert.equal(card.querySelectorAll('input').find(input => input.getAttribute('aria-label') === 'Education entry').value, 'MSc Computer Science, Example Technical University');
  assert.ok(!card.querySelectorAll('input').some(input => input.getAttribute('aria-label') === 'Degree / qualification'), 'never put whole into Degree');
  assert.match(card.textContent, /confirmed 2 Oct 2026/, 'the note is shown and kept');
  card.querySelectorAll('button').find(button => button.textContent === 'Organize into fields').listeners.click[0]({preventDefault() {}});
  card = cardOf(node, 'education');
  assert.match(card.textContent, /Was: MSc Computer Science, Example Technical University/);
  assert.equal(profileBar().count(), 0, 'organized but nothing typed: no change');
  const input = label => card.querySelectorAll('input').find(each => each.getAttribute('aria-label') === label);
  type(input('Degree / qualification'), 'MSc Computer Science');
  type(input('School'), 'Example Technical University');
  type(input('Years'), '2014 – 2016');
  await profileBar().saveAll();
  assert.deepEqual(sent, [['profile', [{op: 'text', id: 'e1', value: 'MSc Computer Science · Example Technical University · 2014 – 2016', was: PROFILE[6].text}]]]);
});

test('two cards edited: one write with both changes', async () => {
  const node = await open();
  edit(node, 'summary');
  edit(node, 'education');
  type(cardOf(node, 'summary').querySelector('textarea'), 'SRE with 9 years on AWS.');
  cardOf(node, 'education').querySelectorAll('button').find(button => button.textContent === '+ Add education').listeners.click[0]({preventDefault() {}});
  const fields = cardOf(node, 'education').querySelectorAll('input').filter(each => each.getAttribute('aria-label') === 'Degree / qualification');
  type(fields[fields.length - 1], 'CKA');
  assert.equal(profileBar().count(), 2);
  await profileBar().saveAll();
  assert.equal(sent.length, 1, 'one write');
  assert.deepEqual(sent[0][1].map(change => change.op), ['text', 'insert']);
  assert.deepEqual(sent[0][1][1], {op: 'insert', after: 'e2', lines: ['CKA ·']});
});

test('Done (card-shell.js) leaves an editor with no change; it hides once the card holds a change', async () => {
  const node = await open();
  edit(node, 'summary');
  const close = cardOf(node, 'summary').querySelector('.card-done');
  assert.equal(close.hidden, false);
  type(cardOf(node, 'summary').querySelector('textarea'), 'Changed.');
  assert.equal(cardOf(node, 'summary').querySelector('.card-done').hidden, true);
  profileBar().discardAll({ask: false});
  assert.ok(!cardOf(node, 'summary').classList.contains('is-editing'), 'Discard all closes the editor');
});

test('a write that fails keeps every draft and its editor, and says why', async () => {
  const node = await open();
  edit(node, 'summary');
  type(cardOf(node, 'summary').querySelector('textarea'), 'Changed.');
  refuse = true;
  const result = await profileBar().saveAll();
  refuse = false;
  assert.equal(result.ok, false);
  assert.match(result.failed[0].error, /changed meanwhile/);
  assert.ok(cardOf(node, 'summary').classList.contains('is-editing'));
  assert.equal(cardOf(node, 'summary').querySelector('textarea').value, 'Changed.', 'the draft is still there');
  assert.equal(profileBar().count(), 1);
});

test('another card\'s save moved the lines (this Mac\'s ids are line numbers): the write finds each line again on a fresh read', async () => {
  const numbered = items => items.map((item, i) => ({...item, id: String(i + 1)}));
  outline = numbered(PROFILE);
  const node = await open();
  edit(node, 'education');
  cardOf(node, 'education').querySelectorAll('button').find(button => button.textContent === 'Remove entry').listeners.click[0]({preventDefault() {}});
  outline = numbered([{id: '', type: 'bulleted_list_item', text: 'Permit: B (saved by Your details just before)'}, ...PROFILE]);
  await profileBar().saveAll();
  outline = PROFILE;
  assert.deepEqual(sent, [['profile', [{op: 'remove', id: '8', was: PROFILE[6].text}]]], 'line 7 then, line 8 now');
});
