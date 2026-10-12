// A Finder issue closed by a fix ("Fixes #N" in a commit or a merged pull request) is counted as a real bug, fixed (12 Oct 2026: #360 and #400 were not).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {labelsForClose} from '../lib/fixed-close.mjs';

const commit = {__typename: 'Commit', oid: '534cf0e0000000000000000000000000000000000', url: 'https://github.com/o/r/commit/534cf0e'};
const merged = {__typename: 'PullRequest', number: 465, merged: true, url: 'https://github.com/o/r/pull/465'};

test('closed by a commit or a merged pull request, with no resolution yet: confirmed and resolution:fixed', () => {
  const cases = [
    // [what, issue, expected labels or null]
    ['#360: closed by its fix commit', {labels: ['auto-ui', 'needs-human'], stateReason: 'COMPLETED', closer: commit}, ['confirmed', 'resolution:fixed']],
    ['#400: closed by its fix commit, already confirmed', {labels: ['auto-ui', 'confirmed'], stateReason: 'COMPLETED', closer: commit}, ['resolution:fixed']],
    ['closed by a merged pull request', {labels: ['auto-ui'], stateReason: 'COMPLETED', closer: merged}, ['confirmed', 'resolution:fixed']],
    ['a verdict already said why (apply-verdict.sh labels before it closes)', {labels: ['auto-ui', 'resolution:fp:detector'], stateReason: 'COMPLETED', closer: commit}, null],
    ['closed as not planned', {labels: ['auto-ui'], stateReason: 'NOT_PLANNED', closer: commit}, null],
    ['closed by hand, no fix named', {labels: ['auto-ui'], stateReason: 'COMPLETED', closer: null}, null],
    ['a pull request that was not merged', {labels: ['auto-ui'], stateReason: 'COMPLETED', closer: {...merged, merged: false}}, null],
    ['not a Finder issue (a person\'s: tracker-sync.yml handles it)', {labels: ['bug'], stateReason: 'COMPLETED', closer: commit}, null],
  ];
  for (const [what, issue, expected] of cases) assert.deepEqual(labelsForClose(issue)?.add ?? null, expected, what);
});

test('the comment names the fix', () => {
  assert.match(labelsForClose({labels: ['auto-ui'], stateReason: 'COMPLETED', closer: commit}).comment, /534cf0e/);
  assert.match(labelsForClose({labels: ['auto-ui'], stateReason: 'COMPLETED', closer: merged}).comment, /#465/);
});
