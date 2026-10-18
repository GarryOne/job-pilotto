// The Voluntary surveys card: one row per question with its fixed list and Decline, the note under it; saving writes marked lines and keeps what it does not know.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

install();
const {surveyBody, surveyForm, otherRow} = await import('../renderer/survey-rows.js');
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
  const other = all(shown).filter(each => /survey-other/.test(each.className))[0];
  assert.equal(all(other).filter(each => each.tagName === 'DT').length, 2, 'the two labelled lines are rows');
  assert.equal(all(other).filter(each => /survey-stacked/.test(each.className) && each.tagName === 'DT').length, 1, 'only the long question stacks above its answer');
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
