// Commit-time check of trailer values (tools/commit-trailers.mjs): a wrong value fails when the message is written, not at the push gate.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {messageProblems} from '../../tools/commit-trailers.mjs';

const IDS = ['aldi-suisse', 'trap-press-address-de'];
const bad = message => messageProblems(message, IDS).join('\n');

test('a message with no trailers, or good ones, has no problem', () => {
  assert.deepEqual(messageProblems('Fix a label\n\nbody', IDS), []);
  assert.deepEqual(messageProblems('Fix\n\nRung: 3, router\nFixture: aldi-suisse, trap-press-address-de\nPool-row: Acme Corp\nRecorded-unneeded: a log line\nE2E-issue: none the step is unrelated', IDS), []);
  assert.deepEqual(messageProblems('Fix\n\nRung: none: a log line\nFixture: none: a pure move', IDS), []);
});

test('every wrong value names its line (the "Rung: 1 " that cost a ship cycle is not the only one)', () => {
  for (const [message, pattern] of [
    ['x\n\nRung: 7', /"Rung: 7" is not 0-6/], ['x\n\nRung: one', /"Rung: one"/], ['x\n\nRung: none', /"Rung: none" needs a reason/],
    ['x\n\nFixture: nope', /no fixture "nope"/], ['x\n\nFixture: none', /"Fixture: none" needs a reason/],
    ['x\n\nPool-row: https://a.example/jobs?id=1', /Pool-row/], ['x\n\nPool-row:', /Pool-row/],
    ['x\n\nRecorded-unneeded:', /Recorded-unneeded/], ['x\n\nE2E-issue: none', /E2E-issue/], ['x\n\nE2E-issue: 12', /E2E-issue/],
  ]) assert.match(bad(message), pattern, message);
});

test("git's own comment lines are not the message", () => {
  assert.deepEqual(messageProblems('Fix\n\n# Rung: 9\n# Please enter the commit message', IDS), []);
});

test('a trailer name inside a sentence is not a trailer', () => {
  assert.deepEqual(messageProblems('Fix\n\nthe Rung: line is checked at commit time', IDS), []);
});
