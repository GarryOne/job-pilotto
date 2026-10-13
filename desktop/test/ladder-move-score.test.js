// The next move both ways (e2e/lib/ladder-move-score.mjs, box 7 of spec 2026-10-12-one-next-move.md): today's rung-2 button vs the fallback's digest move on a fixture with a confirmed
// expected move; an unsure answer climbs (never "right"), a sure wrong press is wrong-and-confident, and with the fallback only today's stops change.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fallbackMove, summarizeMoves, todayMove, withFallback} from '../e2e/lib/ladder-move-score.mjs';

const fixture = {id: 'p', source: 'captured', candidates: [{n: 1, text: 'About us'}, {n: 2, text: 'Apply now'}], expect: {outcome: 'posting', verb: 'press', candidates: [2]}};

test('today: the button rung 2 names, by the candidates\' own text', () => {
  assert.equal(todayMove(fixture, 'APPLY  now'), 'right');
  assert.equal(todayMove(fixture, 'About us'), 'wrong');
  assert.equal(todayMove(fixture, ''), 'stop');
});

test('the fallback: right only when sure; a sure press on another control is wrong-and-confident', () => {
  assert.equal(fallbackMove(fixture, {verb: 'press', numbers: [2], confidence: 0.9}), 'right');
  assert.equal(fallbackMove(fixture, {verb: 'open', numbers: [2], confidence: 0.9}), 'right', 'open and press act on the same numbered control');
  assert.equal(fallbackMove(fixture, {verb: 'press', numbers: [2], confidence: 0.6}), 'unsure');
  assert.equal(fallbackMove(fixture, {verb: 'press', numbers: [1], confidence: 0.9}), 'wrong-confident');
  assert.equal(fallbackMove(fixture, {verb: 'press', numbers: [1], confidence: 0.5}), 'wrong');
  assert.equal(fallbackMove(fixture, {verb: 'tell_person', numbers: [], confidence: 0.9}), 'wrong', 'telling the person never acts');
  assert.equal(fallbackMove(fixture, {error: 'not listed', confidence: 0.9}), 'wrong');
});

test('with the fallback only today\'s stops change, and a sure wrong move counts against it', () => {
  assert.equal(withFallback('right', 'wrong-confident'), 'right');
  assert.equal(withFallback('stop', 'right'), 'right');
  assert.equal(withFallback('stop', 'unsure'), 'stop');
  assert.equal(withFallback('stop', 'wrong-confident'), 'wrong');
  const summary = summarizeMoves([{id: 'a', source: 'captured', today: 'stop', fallback: 'right'}, {id: 'b', source: 'recorded', today: 'right', fallback: 'wrong-confident'},
    {id: 'c', source: 'invented', today: 'stop', fallback: 'unsure'}]);
  assert.deepEqual(summary.bySource.real, {fixtures: 2, deadEnds: 1, today: {stop: 1, right: 1}, fallback: {right: 1, 'wrong-confident': 1}, both: {right: 2}});
  assert.deepEqual(summary.bySource.invented, {fixtures: 1, deadEnds: 1, today: {stop: 1}, fallback: {unsure: 1}, both: {stop: 1}});
  assert.deepEqual(summary.wrongConfident, ['b']);
});
