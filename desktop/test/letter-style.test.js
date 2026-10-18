// Profile → Cover letter → Letter style (pages/letter-style.js; owner, 17 Oct 2026: the Cover letter tab is the one home for letters): the "Cover
// letter style" rules of the standard answers, edited here and no longer listed in Application answers; a new rule lands in that section (or the
// section is added), so the letter prompts that read the whole answers page keep following it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

const body = install();
const ANSWERS = [{id: 'h1', type: 'heading_2', text: 'Common questions'}, {id: 'q1', type: 'bulleted_list_item', text: 'Why us? Your mission'},
  {id: 'h2', type: 'heading_2', text: 'Cover letter style'}, {id: 's1', type: 'bulleted_list_item', text: 'Length: 130–170 words'},
  {id: 's2', type: 'bulleted_list_item', text: 'Never mention: salary'}];

async function open(load, id, items, sent = []) {
  globalThis.window.pilot = new Proxy({textOutline: async name => ({ok: true, items: name === 'answers' ? items : [], store: 'Notion'}),
    textEdit: async (name, changes) => { sent.push([name, changes]); return {ok: true, items}; }}, {get: (all, key) => all[key] || (() => null)});
  const node = globalThis.document.createElement('div');
  node.id = id;
  body.replaceChildren(node);
  await load();
  return node;
}
const loadStyle = async () => (await import('../renderer/pages/letter-style.js')).loadLetterStyle();

test('the style rules show on the Cover letter tab, one input each; Application answers no longer lists them', async () => {
  const style = await open(loadStyle, 'letter-style-body', ANSWERS);
  assert.deepEqual(style.querySelectorAll('input').map(input => input.value).filter(Boolean), ['130–170 words', 'salary']);
  const answers = await open(async () => (await import('../renderer/pages/application-answers.js')).loadApplicationAnswers(), 'answers-body', ANSWERS);
  assert.ok(!answers.textContent.includes('Cover letter style') && !answers.textContent.includes('Never mention'), answers.textContent);
});

test('a rule edited writes its own line; a new rule goes after the section, or adds the section', async () => {
  const sent = [];
  const node = await open(loadStyle, 'letter-style-body', ANSWERS, sent);
  const field = node.querySelectorAll('input').find(input => input.value === 'salary');
  field.value = 'salary, notice period';
  field.dispatch('input');
  const add = node.querySelectorAll('input').find(input => input.ariaLabel === 'Add a style rule');
  add.value = 'Tone: direct';
  add.dispatch('input');
  await node.querySelector('#outline-save-letterstyle').listeners.click[0]();
  assert.deepEqual(sent, [['answers', [{op: 'text', id: 's2', value: 'Never mention: salary, notice period', was: 'Never mention: salary'},
    {op: 'insert', after: 's2', key: 'add-style', lines: ['Tone: direct']}]]]);
  const none = [], bare = await open(loadStyle, 'letter-style-body', ANSWERS.slice(0, 2), none);
  const first = bare.querySelectorAll('input').find(input => input.ariaLabel === 'Add a style rule');
  first.value = 'Length: short';
  first.dispatch('input');
  await bare.querySelector('#outline-save-letterstyle').listeners.click[0]();
  assert.deepEqual(none, [['answers', [{op: 'section', heading: 'Cover letter style', lines: ['Length: short']}]]]);
});

test('the letter prompt still reads the style from the answers page (nothing moved out of it)', () => {
  assert.match(fs.readFileSync(new URL('../lib/job-letter.js', import.meta.url), 'utf8'), /"Cover letter style"/);
});

test('the card reads first: each rule as label and value, a quiet Edit opens the inputs, saving or discarding reads again', async () => {
  const node = await open(loadStyle, 'letter-style-body', ANSWERS);
  const card = globalThis.document.createElement('div'), edit = globalThis.document.createElement('button');
  card.id = 'setting-letter-style'; edit.id = 'letter-style-edit';
  card.append(edit, node); body.replaceChildren(card);
  const read = node.querySelector('.card-read');
  assert.deepEqual(read.querySelectorAll('dt').map(term => term.textContent), ['Length', 'Never mention']);
  assert.deepEqual(read.querySelectorAll('dd').map(value => value.textContent), ['130–170 words', 'salary']);
  assert.ok(node.querySelector('.card-editor input'), 'the inputs live in the editor');
  const empty = await open(loadStyle, 'letter-style-body', ANSWERS.slice(0, 2));
  assert.match(empty.querySelector('.card-read').textContent, /No preferences yet: letters use a short, direct default/);
});

test('Done closes an unchanged editor; once a rule changes, only the save bar closes it', async () => {
  const node = await open(loadStyle, 'letter-style-body', ANSWERS);
  const card = globalThis.document.createElement('div');
  card.id = 'setting-letter-style'; card.append(node); body.replaceChildren(card);
  card.classList.add('is-editing');
  const done = node.querySelector('.card-done');
  assert.equal(done.hidden, false);
  done.listeners.click[0]();
  assert.ok(!card.classList.contains('is-editing'), 'Done reads again');
});
