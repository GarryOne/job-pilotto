// When the AI is asked whether an application form is ready (extension/form-ready.js): only when the panel's own count claims it, never on an account page.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {claimsReady} from '../../extension/form-ready.js';

test('the AI is asked only when the count says every required field is filled on an application page', () => {
  assert.equal(claimsReady({total: 8, left: 0, account: false}), true);
  assert.equal(claimsReady({total: 8, left: 2, account: false}), false);   // not ready by the count: nothing to veto
  assert.equal(claimsReady({total: 0, left: 0, account: false}), false);   // no required field seen
  assert.equal(claimsReady({total: 8, left: 0, account: true}), false);   // an account page has its own judge
  assert.equal(claimsReady(undefined), false);
});
