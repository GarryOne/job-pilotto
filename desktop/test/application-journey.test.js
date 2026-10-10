// The journey reducer's invariants (lib/application-journey.js header), one test each; the scenarios are in test/journeys.test.js.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {journey, journeyStep} from '../lib/application-journey.js';

const form = (extra = {}) => ({kind: 'form', stuck: '', stage: '', accountState: '', accountNeeds: '', note: '', ...extra});

test('1: a finished application never changes step', () => {
  for (const event of [{type: 'stage', stage: 'form'}, {type: 'account', state: 'created'}, {type: 'stuck', why: 'account'}]) {
    assert.deepEqual(journey(form({outcome: 'submitted'}), event).set, {});
  }
  assert.equal(journeyStep(form({outcome: 'submitted', stage: 'form'})).step, 'ended');
});

test('2: "no form" never lands on an application at the account step', () => {
  assert.deepEqual(journey(form({stage: 'account'}), {type: 'stuck', why: 'no-form'}), {set: {}, result: false});
  assert.equal(journey(form(), {type: 'stuck', why: 'no-form'}).set.stuck, 'no-form');   // before the account step it does
});

test('3: stuck at the account step: only a new need changes it', () => {
  const at = form({stuck: 'account', stage: 'account', note: 'This site needs an account'});
  assert.deepEqual(journey(at, {type: 'stuck', why: 'incomplete', needs: 'x'}).set, {});
  assert.deepEqual(journey(at, {type: 'stuck', why: 'account'}).set, {});
  assert.deepEqual(journey(at, {type: 'stuck', why: 'account', needs: 'Verification code'}).set, {note: 'Needs you: Verification code', accountNeeds: 'Verification code'});
});

test('4: "incomplete" is cleared only by clear-stuck', () => {
  const at = form({stuck: 'incomplete', accountNeeds: 'n'});
  assert.deepEqual(journey(at, {type: 'stage', stage: 'form'}).set, {stage: 'form'});
  assert.deepEqual(journey(at, {type: 'clear-stuck'}).set, {stuck: '', accountNeeds: '', note: 'Form open in Chrome'});
});

test('5: only fixed values are written, a need at most 80 characters', () => {
  assert.deepEqual(journey(form(), {type: 'stage', stage: 'somewhere'}).set, {});
  assert.deepEqual(journey(form(), {type: 'account', state: 'maybe'}).set, {});
  assert.deepEqual(journey(form(), {type: 'stuck', why: 'lost'}).set, {});
  assert.equal(journey(form(), {type: 'stuck', why: 'account', needs: 'x'.repeat(200)}).set.accountNeeds.length, 80);
  assert.deepEqual(journey(form(), {type: 'stuck', why: 'account', accountStep: 'teleport'}).set.accountStep, undefined);
});

test('6: the account record: terms accepted (at most 3, 80 characters each, once each) and the code from the mail, only on a running application', () => {
  const a = form({});
  assert.deepEqual(journey(a, {type: 'account-fact', fact: 'terms', text: '  I accept   the terms '}).set, {accountTerms: ['I accept the terms']});
  assert.deepEqual(journey(form({accountTerms: ['I accept the terms']}), {type: 'account-fact', fact: 'terms', text: 'I accept the terms'}).set, {}, 'once');
  assert.deepEqual(journey(form({accountTerms: ['a', 'b', 'c']}), {type: 'account-fact', fact: 'terms', text: 'd'}).set, {}, 'at most 3');
  assert.equal(journey(a, {type: 'account-fact', fact: 'terms', text: 'x'.repeat(200)}).set.accountTerms[0].length, 80);
  assert.deepEqual(journey(a, {type: 'account-fact', fact: 'terms', text: ''}).set, {}, 'nothing named, nothing recorded');
  assert.deepEqual(journey(a, {type: 'account-fact', fact: 'code'}).set, {accountCode: true});
  assert.deepEqual(journey(form({accountCode: true}), {type: 'account-fact', fact: 'code'}).set, {});
  assert.deepEqual(journey(a, {type: 'account-fact', fact: 'password'}).set, {}, 'only fixed facts');
  assert.deepEqual(journey(form({outcome: 'submitted'}), {type: 'account-fact', fact: 'code'}).set, {}, 'a finished application never changes');
});
