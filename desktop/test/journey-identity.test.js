// The one session resolver (lib/journey-identity.js): its invariants.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {resolveSession} from '../lib/journey-identity.js';
import {isFormOf} from '../lib/apply.js';

const POSTING_A = 'https://www.jobs.ch/en/vacancies/detail/aaaa1111/', POSTING_B = 'https://www.jobs.ch/en/vacancies/detail/bbbb2222/';
const sessions = [{id: 'a', kind: 'form', url: POSTING_A}, {id: 'b', kind: 'form', url: POSTING_B}, {id: 'done', kind: 'form', url: 'https://x.example/job/1', outcome: 'submitted'}, {id: 'c', kind: 'claude', url: POSTING_A}];
const deps = {get: id => sessions.find(item => item.id === id) || null, list: () => sessions, isFormOf};

test('a tab with no id is matched by its job (the posting it was opened for), not by the sign-in page it is on', () => {
  assert.equal(resolveSession({session: '', job: POSTING_B, url: 'https://auth.jobs.ch/u/login/identifier'}, deps), 'b');
});

test('1: a carried live form id wins over a job match', () => {
  assert.equal(resolveSession({session: 'a', job: POSTING_B}, deps), 'a');
});

test('2: a finished session is never matched; a carried non-form id falls back to the job', () => {
  assert.equal(resolveSession({session: 'done', job: 'https://x.example/job/1'}, deps), '');
  assert.equal(resolveSession({session: 'c', job: POSTING_A}, deps), 'a');
});

test('3: nothing to go on: no session', () => {
  assert.equal(resolveSession({}, deps), '');
  assert.equal(resolveSession({job: 'https://unknown.example/'}, deps), '');
});
