// The decision on a sign-in or sign-up page (extension/account-step.js accountMove): from the AI's account step and the app's mode only, never from words.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {accountMove, formOutline} from '../../extension/account-step.js';

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

test('an account was just made for this email: nothing is pressed again, whatever the page says', () => {
  assert.equal(accountMove({step: 'sign_in', mode: 'confirm', hasEmail: true, registerControl: 'Register'}), 'leave');
  assert.equal(accountMove({step: 'sign_up', mode: 'confirm', hasEmail: true}), 'leave');
});

import {resultAction} from '../../extension/account-step.js';

test('what the account AI\'s word after the press means: a usable account is confirmed, one awaiting a mail or code is pending, an existing one is tried, a refusal is said on the page, doubt claims nothing', () => {
  assert.deepEqual(['created', 'created_confirm', 'needs_code', 'already_exists', 'refused', 'unsure', undefined, ''].map(resultAction), ['confirmed', 'pending', 'pending', 'exists', 'flag', 'none', 'none', 'none']);
});

import {consentMove} from '../../extension/account-step.js';

test('the account\'s consent is accepted by the extension only on "full", only when the AI calls it a consent and names a control, and at most three times; a choice, a code or a field is always the person\'s', () => {
  const ask = over => consentMove({automation: 'full', needsKind: 'consent', needs: 'Akzeptieren', presses: 0, ...over});
  assert.equal(ask({}), 'accept');
  assert.equal(ask({automation: 'assist'}), 'person');
  assert.equal(ask({automation: undefined}), 'person');
  for (const needsKind of ['choice', 'code', 'field', 'other', '']) assert.equal(ask({needsKind}), 'person');
  assert.equal(ask({needs: ''}), 'person');
  assert.equal(ask({presses: 3}), 'person');
});

test('a sign-up page where we already have an account: go to the sign-in the AI named, else leave it', () => {
  assert.equal(accountMove({step: 'sign_up', mode: 'sign-in', hasEmail: true, signinControl: 'Melde dich hier an.'}), 'switch');
  assert.equal(accountMove({step: 'sign_up', mode: 'sign-in', hasEmail: true, signinControl: ''}), 'leave');
});

test('a notice that an account exists: press its sign-in control when the account is ours, else leave it (never the password reset)', () => {
  assert.equal(accountMove({step: 'choose', mode: 'sign-in', hasEmail: true, signinControl: 'Anmelden'}), 'switch');
  assert.equal(accountMove({step: 'choose', mode: 'sign-in', hasEmail: true, signinControl: ''}), 'leave');
  assert.equal(accountMove({step: 'choose', mode: 'sign-up', hasEmail: true, signinControl: 'Anmelden'}), 'leave');
});

import {botCheckNeed} from '../../extension/account-step.js';
test('a bot check is the person\'s: the need says to solve it and then press the account button, by the page\'s own name when the AI gave one', () => {
  assert.equal(botCheckNeed('Créer un compte'), 'Solve the check, then press "Créer un compte"');
  assert.equal(botCheckNeed(''), 'Solve the check, then press the account button');
  assert.ok(botCheckNeed('x'.repeat(200)).length < 80);   // the app keeps 80 characters of a need
});

test('the form outline at the press: types and labels only, so a refusal (values and states changed) is the same form, the next page is not', () => {
  const form = {controls: [{type: 'email', label: 'E-Mail', state: 'filled'}, {type: 'password', label: 'Passwort', state: 'filled'}]};
  const refused = {controls: [{type: 'email', label: 'E-Mail', state: 'filled'}, {type: 'password', label: 'Passwort', state: 'empty'}]};
  const next = {controls: [{type: 'text', label: 'Vorname', state: 'empty'}, {type: 'file', label: 'Lebenslauf', state: 'empty'}]};
  assert.equal(formOutline(refused), formOutline(form));
  assert.notEqual(formOutline(next), formOutline(form));
  assert.equal(formOutline(null), '');
});

test('the account\'s outcome and the page kind are asked together; the submit watch leaves a sign-up\'s next page alone for two minutes', async () => {
  const {outcomePending, OUTCOME_WAIT_MS} = await import('../../extension/account-step.js');
  const now = 1_000_000;
  assert.equal(outcomePending(null, now), false);
  assert.equal(outcomePending({at: now - 5000}, now), true);                  // a sign-up just filled or pressed: its outcome is the account AI's word first
  assert.equal(outcomePending({at: now - OUTCOME_WAIT_MS - 1}, now), false);  // two minutes later a press is the person's own submit again
  const fs = await import('node:fs');
  const flow = fs.readFileSync(new URL('../../extension/fill-flow.js', import.meta.url), 'utf8');
  assert.match(flow, /const kindAsk = askKind\(tab\), outcomeLook = accountOutcome\(tab\)\.catch\(\(\) => \{\}\);/);   // both asked at once (9 Oct 2026: 13 s + 9 s one behind the other)
  assert.match(flow, /if \(asked\?\.role !== 'form'\) await outcomeLook;/);   // the application form is filled without waiting for the sign-up's outcome (40 s on Migros)
  assert.match(flow, /kind = asked;/);
  const watch = fs.readFileSync(new URL('../../extension/submit-watch.js', import.meta.url), 'utf8');
  assert.ok(watch.indexOf('accountOutcomePending(tabId)') > 0 && watch.indexOf('accountOutcomePending(tabId)') < watch.indexOf('asking whether it confirms'));
});
