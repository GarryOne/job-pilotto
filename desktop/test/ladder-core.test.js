// The ladder's signals and router (extension/ladder/core.js): the fixed signals every rung returns, and the one pure rule that says which rung to ask next.
// Guards its invariants: fixed values only, never past a rung that is off or capped, Claude's takeover offered and never started by the router, nothing unknown guessed.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {RUNGS, SIGNALS, ladderLine, nextRung} from '../../extension/ladder/core.js';

test('the rungs and signals are fixed lists (the admin page and the log parser read these exact values)', () => {
  assert.deepEqual(Object.values(RUNGS), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(SIGNALS, ['confident', 'unsure', 'contradicted', 'stalled', 'failed']);
});

test('a confident rung stays: nothing climbs', () => {
  for (const rung of [0, 1, 2, 3, 4]) assert.deepEqual(nextRung({rung, signal: 'confident'}), {rung, climbed: false});
});

test('an unsure, contradicted, stalled or failed rung climbs to the next rung that is on', () => {
  for (const signal of ['unsure', 'contradicted', 'stalled', 'failed']) {
    assert.equal(nextRung({rung: 2, signal}).rung, 3, `${signal}: the sketch climbs to the digest`);
    assert.equal(nextRung({rung: 3, signal}).rung, 4, `${signal}: the digest climbs to the picture`);
  }
  assert.deepEqual(nextRung({rung: 2, signal: 'unsure'}), {rung: 3, climbed: true, from: 2, signal: 'unsure'});
});

test('a kept answer the page contradicts is asked again one rung up, not trusted', () => {
  assert.equal(nextRung({rung: 1, signal: 'contradicted'}).rung, 2);
});

test('a rung that is off or capped is skipped, never asked', () => {
  assert.equal(nextRung({rung: 2, signal: 'unsure', off: [3]}).rung, 4);
  assert.equal(nextRung({rung: 2, signal: 'unsure', capped: [3, 4]}).rung, 6, 'nothing left: the person');
});

test('Claude\'s takeover is never started by the router: after the picture comes the person (who is offered it)', () => {
  assert.equal(nextRung({rung: 4, signal: 'unsure'}).rung, 6);
  assert.equal(nextRung({rung: 3, signal: 'unsure', capped: [4]}).rung, 6);
  for (const rung of [0, 1, 2, 3, 4]) for (const signal of ['unsure', 'contradicted', 'stalled', 'failed']) assert.notEqual(nextRung({rung, signal}).rung, 5);
});

test('the structure rule is the floor without AI: when it is not sure either, the person', () => {
  assert.equal(nextRung({rung: 0, signal: 'unsure', off: [1, 2, 3, 4]}).rung, 6);
});

test('the person is the top: nothing climbs past it', () => {
  assert.deepEqual(nextRung({rung: 6, signal: 'unsure'}), {rung: 6, climbed: false});
});

test('an unknown signal or rung is never guessed: it goes to the person', () => {
  assert.equal(nextRung({rung: 2, signal: 'maybe'}).rung, 6);
  assert.equal(nextRung({rung: 9, signal: 'unsure'}).rung, 6);
});

test('the log line has the one shape the admin page parses, and says nothing for a confident rung', () => {
  assert.equal(ladderLine({rung: 2, signal: 'unsure'}), 'ladder: rung 2 signal unsure');
  assert.equal(ladderLine({rung: 4, signal: 'stalled'}), 'ladder: rung 4 signal stalled');
  assert.equal(ladderLine({rung: 2, signal: 'confident'}), '');
  assert.equal(ladderLine({rung: 2, signal: 'bogus'}), '');
  for (const rung of [0, 1, 2, 3, 4, 5, 6]) for (const signal of SIGNALS.filter(one => one !== 'confident')) assert.match(ladderLine({rung, signal}), /^ladder: rung [0-6] signal (unsure|contradicted|stalled|failed)$/);
});

test('every judge answers with the same fixed signals: an account judgment, the closer look, anything unknown', async () => {
  const {signalOf} = await import('../../extension/ladder/core.js');
  assert.equal(signalOf({answer: 'ready'}), 'confident');
  assert.equal(signalOf({answer: 'created'}), 'confident');
  assert.equal(signalOf({answer: 'unsure'}), 'unsure');
  assert.equal(signalOf({error: 'cut off'}), 'failed');
  for (const action of ['click', 'fill', 'choose', 'wait']) assert.equal(signalOf({action}), 'confident', action);
  for (const action of ['none', 'ask_person']) assert.equal(signalOf({action}), 'unsure', `${action} hands the page up`);
  for (const nothing of [null, undefined, {}, 'x', 3]) assert.ok(SIGNALS.includes(signalOf(nothing)), 'never a value outside the fixed list');
  assert.equal(signalOf(null), 'failed');
});
