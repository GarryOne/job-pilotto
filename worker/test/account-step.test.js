// The decision on a sign-in or sign-up page (extension/account-step.js accountMove): from the AI's account step and the app's mode only, never from words.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {accountMove} from '../../extension/account-step.js';

test('a sign-in page where this email has no account: never sign in; follow the register control the AI named, else leave it to the person', () => {
  assert.equal(accountMove({step: 'sign_in', mode: 'sign-up', hasEmail: true, registerControl: 'Hier registrieren'}), 'register');
  assert.equal(accountMove({step: 'sign_in', mode: 'sign-up', hasEmail: true, registerControl: ''}), 'leave');
});

test('a sign-up page fills and presses when we have no account; a sign-in page when we do; a mismatch is left alone', () => {
  assert.equal(accountMove({step: 'sign_up', mode: 'sign-up', hasEmail: true}), 'fill-press');
  assert.equal(accountMove({step: 'sign_in', mode: 'sign-in', hasEmail: true}), 'fill-press');
  assert.equal(accountMove({step: 'sign_up', mode: 'sign-in', hasEmail: true}), 'leave');
});

test('without the AI\'s word or without an email: the password only, nothing is pressed', () => {
  assert.equal(accountMove({step: '', mode: 'sign-up', hasEmail: true}), 'fill');
  assert.equal(accountMove({step: 'sign_up', mode: 'sign-up', hasEmail: false}), 'fill');
});
