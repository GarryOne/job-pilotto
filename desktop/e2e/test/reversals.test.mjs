// The owner's corrections become lessons for the judges; the loop's own events never do.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {lessonsBlock, reversalsFrom} from '../lib/reversals.mjs';

const issue = (number, labels, extra = {}) => ({number, title: `[auto-ui] jobs: thing ${number}`, labels: labels.map(name => ({name})), ...extra});
const event = (kind, who, iss, extra = {}) => ({event: kind, actor: {login: who}, issue: iss, created_at: '2026-10-05T10:00:00Z', ...extra});

test('a reopened noise issue, a removed confirmed and a confirmed closed as not planned are corrections; the bot\'s are not', () => {
  const events = [
    event('reopened', 'GarryOne', issue(1, ['auto-ui', 'wontfix-auto'])),
    event('unlabeled', 'GarryOne', issue(2, ['auto-ui']), {label: {name: 'confirmed'}}),
    event('closed', 'GarryOne', issue(3, ['auto-ui', 'confirmed'], {state_reason: 'not_planned'})),
    event('unlabeled', 'github-actions[bot]', issue(4, ['auto-ui']), {label: {name: 'confirmed'}}),
    event('reopened', 'GarryOne', issue(5, ['auto-ui'])),
    event('unlabeled', 'GarryOne', issue(6, ['auto-ui']), {label: {name: 'not-seen-latest'}}),
    event('reopened', 'GarryOne', issue(7, ['wontfix-auto'])),
    event('unlabeled', 'GarryOne', issue(8, ['auto-ui'], {comments: 3}), {label: {name: 'confirmed'}}),   // GitHub's event: comments is a count
  ];
  const words = {1: {comments: [{author: {login: 'GarryOne'}, authorAssociation: 'OWNER', body: 'This is real: the menu cannot be reached at 640 px.'}]}};
  const list = reversalsFrom(events, words);
  assert.deepEqual(list.map(item => item.number), [1, 2, 3, 8]);
  assert.match(list[0].now, /reopened it: it was real/);
  assert.equal(list[0].words, 'This is real: the menu cannot be reached at 640 px.');
  const block = lessonsBlock(list);
  assert.match(block, /PAST VERDICTS A PERSON CORRECTED/);
  assert.match(block, /#1 "jobs: thing 1": the loop judged noise .* Their words: "This is real/);
  assert.equal(lessonsBlock([]), '');
});
