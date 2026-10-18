// The Voluntary surveys card: one row per question with its fixed list and Decline, the note under it; saving writes marked lines and keeps what it does not know.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

install();
const {surveyBody, surveyForm, otherRow, valueAndNote} = await import('../renderer/survey-rows.js');
const {SURVEYS, DECLINE, lineOf, readLine} = await import('../renderer/survey-model.js');
const part = {lines: [{id: 'a', text: lineOf('gender', 'Man', 'or Male')}, {id: 'b', text: 'How many companies?: 4'}]};
const all = node => [node, ...(node.children || []).flatMap(all)];

test('the form has one row per question with Decline in its list, and the note under the choice', () => {
  const {node} = surveyForm(part);
  const rows = node.children.filter(child => child.className === 'survey-row');
  assert.equal(rows.length, SURVEYS.length);
  assert.ok(SURVEYS.every(each => each.options.at(-1) === DECLINE));
  assert.equal(all(rows[1]).filter(each => each.className === 'fact-note').length, 1);
});

test('texts(): an unchanged form gives the lines back; a changed choice rewrites only that line; the unknown line stays', () => {
  const form = surveyForm(part);
  assert.deepEqual(form.texts(), part.lines.map(line => line.text));
  const note = all(form.node).find(each => each.ariaLabel === 'Veteran status: note');
  note.value = 'confirmed';
  note.listeners.input?.forEach(fn => fn({}));
  assert.deepEqual(form.texts(), part.lines.map(line => line.text), 'a note without a choice writes nothing');
});

test('the card body shows answers with their notes, and "Not set yet." when empty', () => {
  const text = node => all(node).map(each => each.textContent || '').join(' ');
  assert.match(text(surveyBody(part)), /Gender identity.*Man.*or Male.*How many companies\?.*4/s);
  const empty = all(surveyBody({lines: []})).filter(each => /survey-unset/.test(each.className));
  assert.equal(empty.length, SURVEYS.length, 'every question always shows a row; an unanswered one says "Not set", muted');
  assert.equal(readLine(lineOf('age', DECLINE)).option, DECLINE);
});

test('class: no line of the card is drawn as a raw paragraph wall; a "Label: value" line is a row, "Sorting your answers…" shows while the move runs', () => {
  const lines = ['These answers were confirmed on 25 September 2026. Use them for equivalent questions when the form offers matching choices; ask if a choice has a different meaning.',
    'For a "Which of the following communities do you belong to?" list covering disability, parenthood and refugee status: None of the above.', 'How many companies?: 4'].map((text, id) => ({id: String(id), text}));
  const text = node => all(node).map(each => each.textContent || '').join(' | ');
  const shown = surveyBody({lines});
  assert.match(text(shown), /None of the above/);
  const others = all(shown).filter(each => each.tagName === 'DT' && /survey-other/.test(each.className));
  assert.equal(others.length, 2, 'the two labelled lines are rows of the same list');
  assert.equal(others[0].textContent, 'For a "Which of the following…', 'a long question is a short label');
  assert.match(others[0].title, /refugee status$/, 'the whole question stays on the label');
  assert.ok(all(shown).some(each => /survey-question/.test(each.className) && /refugee status/.test(text(each))), 'and folded under the answer');
  assert.equal(all(shown).filter(each => each.tagName === 'P' && each.textContent.length > 120 && !/muted/.test(each.className)).length, 0, 'a paragraph is muted small, never body text');
  assert.doesNotMatch(text(surveyBody({lines: []}, {sorting: false})), /Sorting/);
  assert.match(text(surveyBody({lines}, {sorting: true})), /Sorting your answers…/);
  assert.doesNotMatch(text(surveyForm({lines}).node), /Other lines/);
});

test('the question is cut at the FIRST colon, so a colon inside the note stays in the value (owner 18 Oct 2026)', () => {
  const row = otherRow('Race / ethnicity: White (use "White / European" where that is the label). For a "Hispanic or Latino?" yes/no question: No. (confirmed 25 September 2026)');
  assert.equal(row.label, 'Race / ethnicity');
  assert.match(row.value, /^White .*question: No\./);
  assert.equal(otherRow('A paragraph with no colon at all'), null);
});

test('notes for the AI are one folded line at the end, never a paragraph between the answers; the notes under an answer are small and muted', () => {
  const text = node => all(node).map(each => each.textContent || '').join(' | ');
  const shown = surveyBody({lines: [{id: 'a', text: lineOf('gender', 'Man', 'or Male')}, {id: 'b', text: 'Notes for the AI: Use these on any form.'}, {id: 'c', text: 'Notes for the AI: Ask if unsure.'}]});
  const kids = shown.children.map(child => child.tagName + '.' + child.className);
  assert.match(kids.at(-1), /^DETAILS\.survey-notes-read/, 'the notes fold comes last');
  assert.match(text(all(shown).find(each => each.tagName === 'SUMMARY')), /Notes for the AI · 2 notes/);
  assert.ok(all(shown).some(each => /survey-note/.test(each.className) && /muted small/.test(each.className)), 'an answer\'s note is muted and small');
});

test('one row per field: a line written as words fills its question\'s row with "Check", never "Not set" plus a second row (owner 18 Oct 2026)', () => {
  const text = node => all(node).map(each => each.textContent || '').join(' | ');
  const race = 'Race / ethnicity: White (use "White / European" where that is the label). For a "Hispanic or Latino?" yes/no question: No. (confirmed 25 September 2026)';
  const shown = surveyBody({lines: [{id: 'a', text: lineOf('gender', 'Man')}, {id: 'b', text: race}, {id: 'c', text: 'In the past ten years, how many companies have you worked for?: 4 (Acme, Northwind). (confirmed 25 September 2026)'}]});
  const labels = all(shown).filter(each => each.tagName === 'DT').map(each => each.textContent);
  assert.equal(labels.filter(label => label === 'Race / ethnicity').length, 1, 'the field shows once');
  const cell = all(shown).find(each => each.tagName === 'DT' && each.textContent === 'Race / ethnicity');
  const value = cell.parentNode.children[cell.parentNode.children.indexOf(cell) + 1];
  assert.deepEqual(value.children.slice(0, 2).map(each => each.textContent), ['White', 'Check'], 'its value first, then Check');
  assert.match(value.children[2].className, /survey-note-fold/, 'a long note folds after its first words');
  assert.match(text(value), /use "White \/ European" where that is the label · For a "Hispanic or Latino\?" yes\/no question: No · confirmed 25 September 2026/, 'every other word in the note');
  assert.equal(all(shown).filter(each => /survey-unset/.test(each.className)).length, SURVEYS.length - 2, 'Gender and Race are set; the rest say Not set');
  assert.match(text(shown), /In the past ten years, how many…/);
  assert.match(text(shown), /\| 4 \| Acme, Northwind · confirmed 25 September 2026/);
});

test('a value\'s note: a short answer then its brackets or sentence; nothing dropped; unbalanced brackets stay as written', () => {
  assert.deepEqual(valueAndNote('4 (3 firms; the rest (two) were contracts). (confirmed 25 Sep)'), {value: '4', note: '3 firms; the rest (two) were contracts · confirmed 25 Sep'});
  assert.deepEqual(valueAndNote('None of the above.'), {value: 'None of the above.', note: ''});
  assert.deepEqual(valueAndNote('No (I am not (sure'), {value: 'No', note: '(I am not (sure'});
  assert.equal(valueAndNote('A long answer that runs on well past forty characters (with a note)').note, '', 'a long first part is the value as written');
});
