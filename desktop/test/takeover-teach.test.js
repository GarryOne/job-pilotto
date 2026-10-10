// Claude teaches the extension (spec 2026-10-10-claude-finishes-stuck-pages.md part 5; lib/ladder/rung5-takeover-teach.js): the controls a takeover filled that the extension had left are reported as
// "the extension failed here" outcomes by fingerprint (counts, no label, no value), which puts them in the proposer's targets (site/src/recipes.js targets: failed outcomes + a sample).
import assert from 'node:assert/strict';
import {beforeEach, test} from 'node:test';
import {_reset, noteReport, observe, startRun} from '../lib/ladder/rung5-takeover-teach.js';

const JOB = 'https://boards.example.com/jobs/1';
const misses = [
  {fingerprint: 'aaaaaa11', hosts: ['boards.example.com'], questions: ['Country of residence']},
  {fingerprint: 'bbbbbb22', hosts: ['boards.example.com'], questions: ['Salary expectation']},
  {fingerprint: 'cccccc33', hosts: ['other.example.org'], questions: ['Country of residence']},
];
const deps = () => { const reported = []; return {reported, misses, report: items => reported.push(...items), log: () => {}}; };
beforeEach(() => _reset());

test('only a takeover that started teaches: no run, nothing reported', () => {
  const d = deps();
  noteReport(JOB, {url: 'https://boards.example.com/apply', pending: ['Country of residence'], filled: []});
  assert.equal(observe(JOB, {url: 'https://boards.example.com/apply', filled: ['Country of residence']}, d), 0, 'Claude was never started');
  assert.deepEqual(d.reported, []);
});

test('a start needs a report to compare with (what was left when Claude started)', () => {
  assert.equal(startRun(JOB), false);
  noteReport(JOB, {url: 'https://boards.example.com/apply', pending: ['Country of residence'], filled: []});
  assert.equal(startRun(JOB), true);
});

test('fields the extension left and the takeover filled are reported by fingerprint, once, for the same host only; no label or value leaves', () => {
  const d = deps();
  noteReport(JOB, {url: 'https://boards.example.com/apply', pending: ['Country of residence', 'Salary expectation'], filled: ['Name']});
  assert.equal(startRun(JOB), true);
  assert.equal(observe(JOB, {url: 'https://boards.example.com/apply', filled: ['Name', 'Country of residence']}, d), 1);
  assert.deepEqual(d.reported, [{fp: 'aaaaaa11', ok: false, recipe: 0}], 'the right host\'s fingerprint, as a failed outcome without a recipe');
  assert.equal(observe(JOB, {url: 'https://boards.example.com/apply', filled: ['Name', 'Country of residence']}, d), 0, 'the same field is not counted twice');
  assert.equal(JSON.stringify(d.reported).includes('Country'), false, 'no label in what is sent');
  assert.equal(d.reported.length, 1, 'Salary expectation stayed empty: not taught');
});

test('a field that was already filled when Claude started is not credited to Claude', () => {
  const d = deps();
  noteReport(JOB, {url: 'https://boards.example.com/apply', pending: ['Salary expectation'], filled: ['Country of residence']});
  startRun(JOB);
  assert.equal(observe(JOB, {url: 'https://boards.example.com/apply', filled: ['Country of residence']}, d), 0);
});
