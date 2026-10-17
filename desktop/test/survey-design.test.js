// Design checks of the Voluntary surveys editor (owner, 18 Oct 2026: "Choose… with nothing pre-selected", "cut mid-sentence"): a question whose saved line exists never
// shows "Choose…", a note or leftover line is never a one-line box narrower than its text, and the list is sized by CSS, not full width. Guarded here for every question.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

install();
const {surveyForm} = await import('../renderer/survey-rows.js');
const {SURVEYS, DECLINE, lineOf} = await import('../renderer/survey-model.js');
const all = node => [node, ...(node.children || []).flatMap(all)];
const LONG = 'Race / ethnicity prose that keeps going well past one line of a box, with a date (confirmed 25–26 September 2026) and a long remark about which label to use on forms. '.repeat(2);

test('every question with a saved line shows its choice, never "Choose…"; Decline counts as a choice', () => {
  const part = {lines: SURVEYS.map((each, i) => ({id: String(i), text: lineOf(each.key, i % 2 ? DECLINE : each.options[0], 'confirmed')}))};
  const {node} = surveyForm(part);
  SURVEYS.forEach((each, i) => {
    const control = all(node).find(box => box.ariaLabel === each.label);
    assert.equal(control.value, i % 2 ? DECLINE : each.options[0], each.label);
  });
});

test('a saved note and every leftover line sit in a wrapping box tall enough for all of it, never a one-line text input', () => {
  const part = {lines: [{id: 'a', text: lineOf('gender', 'Man', LONG)}, {id: 'b', text: LONG}, {id: 'c', text: `Notes for the AI: ${LONG}`}]};
  const {node} = surveyForm(part);
  const boxes = all(node).filter(box => box.tagName === 'TEXTAREA' || (box.tagName === 'INPUT' && box.type === 'text'));
  assert.ok(boxes.length >= 3);
  for (const box of boxes) {
    assert.equal(box.tagName, 'TEXTAREA', `${box.ariaLabel}: a one-line input would cut its text`);
    assert.ok(box.rows >= Math.ceil(String(box.value).length / 80), `${box.ariaLabel}: ${box.rows} rows for ${String(box.value).length} characters`);
  }
});

test('the note is folded behind "+ note" until it has text; the lists are sized to their choices by CSS', () => {
  const {node} = surveyForm({lines: [{id: 'a', text: lineOf('gender', 'Man', 'or Male')}]});
  const rows = all(node).filter(box => box.className === 'survey-row');
  const gender = rows[1], age = rows[0];
  assert.equal(all(gender).find(box => box.ariaLabel === 'Gender identity: note').hidden, false);
  assert.equal(all(age).find(box => box.ariaLabel === 'Age bracket: note').hidden, true);
  assert.equal(all(age).find(box => box.textContent === '+ note').hidden, false);
  const css = fs.readFileSync(new URL('../renderer/question-review.css', import.meta.url), 'utf8');
  assert.match(css, /\.survey-rows textarea \{[^}]*field-sizing: content/);
  assert.match(css, /\.survey-rows select \{ width: auto;/);
  assert.match(css, /grid-template-columns: 200px max-content minmax\(0, 1fr\)/);
});
