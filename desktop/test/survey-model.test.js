// Voluntary surveys are fixed questions with fixed lists and "Decline" (owner, 17 Oct 2026, decision B), saved as marked lines the same on every store.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DECLINE, SURVEYS, lineOf, noteLine, readLine, readLines, textsFor} from '../renderer/survey-model.js';
import {splitMark} from '../renderer/question-kind.js';

test('every survey question has its fixed choices and ends with Decline', () => {
  assert.equal(SURVEYS.length, 8, 'seven questions and "Hispanic or Latino", asked apart from race');
  for (const each of SURVEYS) {
    assert.equal(each.options.at(-1), DECLINE, each.key);
    assert.equal(new Set(each.options).size, each.options.length, each.key);
  }
});

test('an answer is one marked line with its note, and reads back; no word list is involved', () => {
  const line = lineOf('gender', 'Man', 'or Male when that is the equivalent option');
  assert.match(line, /^Gender identity: Man \(note: or Male when that is the equivalent option\) \[pick one: Man \| Woman \| Non-binary \| Decline to self-identify\]$/);
  assert.equal(splitMark(line).kind, 'single');
  assert.deepEqual(readLine(line), {type: 'answer', key: 'gender', option: 'Man', note: 'or Male when that is the equivalent option'});
  assert.deepEqual(readLine('Race / ethnicity: White'), {type: 'answer', key: 'ethnicity', option: 'White', note: ''});
  assert.equal(readLine('Gender identity: Male').type, 'other', 'a choice that is not in the list is not an answer: it stays as written');
  assert.deepEqual(readLine(noteLine('Use these for equivalent questions.')), {type: 'notes', text: 'Use these for equivalent questions.'});
  assert.equal(readLine('"In the past ten years, how many companies have you worked for?": 4').type, 'other');
});

test('editing keeps lines in place, removes a cleared answer, and adds new ones after', () => {
  const lines = [{id: 'a', text: lineOf('age', '30–39')}, {id: 'b', text: 'Something else: kept'}, {id: 'c', text: lineOf('gender', 'Man')}, {id: 'd', text: noteLine('old')}];
  const texts = textsFor(lines, {age: {option: '40–49'}, gender: {option: ''}, veteran: {option: 'No', note: 'confirmed'}}, ['new note']);
  assert.equal(readLine(texts[0]).option, '40–49');
  assert.equal(texts[1], 'Something else: kept');
  assert.equal(texts[2], '');
  assert.equal(texts[3], noteLine('new note'));
  assert.equal(readLine(texts[4]).key, 'veteran');
  assert.deepEqual([...readLines(lines).answers.keys()], ['age', 'gender']);
});

test('nothing reads the list inside a saved survey mark: a long list is stored as a bare "[pick one]" and every question reads back the same either way', () => {
  for (const each of SURVEYS) {
    const option = each.options[0], short = lineOf(each.key, option, 'a note'), bare = short.replace(/\s*\[[^\]]*\]\s*$/, ' [pick one]'), none = short.replace(/\s*\[[^\]]*\]\s*$/, '');
    assert.deepEqual(readLine(bare), readLine(short), `${each.key}: the card reads the same with the list shortened`);
    assert.deepEqual(readLine(none), readLine(short), `${each.key}: and with no mark at all`);
  }
  assert.match(lineOf('ethnicity', 'White'), /\[pick one\]$/, 'the long Race / ethnicity list is not stored in the mark (over 160 characters); the code keeps the list in SURVEYS');
});
