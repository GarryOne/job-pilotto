// The answers a "needs you" row offers: Claude's proposed one, your own saved answer for the same question, and the
// way out ("Change with Claude…"). Never a guess: only the same question's saved answer is offered.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {answerOptions, askedQuestion, proposedAnswer} from '../renderer/answer-options.js';

test('the proposed answer comes first, then a saved answer for the same question, then Change with Claude…', () => {
  const need = {kind: 'confirm', text: '**Pay:** below your minimum.', label: 'Pay', recommended: 'keep it'};
  const saved = [{question: 'Pay expectations', answer: 'CHF 150k'}, {question: 'Notice period?', answer: '3 months'}];
  assert.deepEqual(answerOptions(need, saved), [
    {value: 'keep it', label: 'keep it', kind: 'proposed'},
    {value: 'CHF 150k', label: 'CHF 150k', kind: 'saved'},
    {value: '', label: 'Change with Claude…', kind: 'change'}]);
});

test('an answer saved for a different question is never offered', () => {
  const need = {kind: 'ask', question: 'Notice period?', why: 'nothing on file'};
  assert.deepEqual(answerOptions(need, [{question: 'Do you need sponsorship?', answer: 'No'}]),
    [{value: '', label: 'Change with Claude…', kind: 'change'}]);
});

test('a fact with no answer yet offers only the way out', () => {
  assert.deepEqual(answerOptions({kind: 'ask', question: 'Degree result?'}, []),
    [{value: '', label: 'Change with Claude…', kind: 'change'}]);
});

test('a line still waiting for an answer in Notion is not an answer', () => {
  const need = {kind: 'ask', question: 'Notice period?', suggested: ''};
  assert.deepEqual(answerOptions(need, [{question: 'Notice period?', answer: '❓ ask me later', open: true}]),
    [{value: '', label: 'Change with Claude…', kind: 'change'}]);
});

test('the proposed answer is the recommended one, else the suggested one, else nothing', () => {
  assert.equal(proposedAnswer({recommended: 'keep it', suggested: 'guess'}), 'keep it');
  assert.equal(proposedAnswer({suggested: '8.5/10'}), '8.5/10');
  assert.equal(proposedAnswer({text: 'no answer'}), '');
  assert.equal(proposedAnswer(null), '');
});

test('the same answer is not offered twice, whatever its source', () => {
  const need = {kind: 'ask', question: 'Notice period?', suggested: '3 months'};
  assert.deepEqual(answerOptions(need, [{question: 'Notice period?', answer: '3 months'}, {question: 'Notice period?', answer: '  '}]),
    [{value: '3 months', label: '3 months', kind: 'proposed'},
      {value: '', label: 'Change with Claude…', kind: 'change'}]);
});

test('a judgement call is asked about by its label, a fact by its question', () => {
  assert.equal(askedQuestion({label: 'Pay', question: ''}), 'Pay');
  assert.equal(askedQuestion({question: 'Notice period?'}), 'Notice period?');
  assert.equal(askedQuestion(null), '');
});
