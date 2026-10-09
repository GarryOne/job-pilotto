// The account AI's judgments (lib/account-judge.js): fixed answers, a control only if the page lists it, no AI means no answer, the model never sees a typed value.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {accountSketch, judgeAccount, listed} from '../lib/account-judge.js';

const page = {url: 'https://karriere.example/career?token=SECRET', title: 'Konto anlegen', headings: ['Konto anlegen'],
  controls: [{type: 'email', label: 'E-Mail-Adresse', required: true, state: 'filled', value: 'me@example.com'}, {type: 'password', label: 'Kennwort', required: true, state: 'filled'}],
  buttons: ['Datenschutzerklärung lesen und akzeptieren.', 'Konto anlegen'], texts: ['Datenschutzerklärung ist erforderlich'], frames: []};
const fake = (answer, seen = []) => ({messages: {create: async body => { seen.push(body); return {content: [{type: 'text', text: JSON.stringify(answer)}], stop_reason: 'end_turn'}; }}});

test('before the press: the AI says needs_person and names the consent LINK; the code keeps it only because the page lists it', async () => {
  const seen = [];
  const got = await judgeAccount(fake({answer: 'needs_person', needs: 'datenschutzerklärung lesen und akzeptieren.', needs_kind: 'consent', bot_check: false, confidence: 0.9}, seen), page, 'ready');
  assert.deepEqual([got.answer, got.needs, got.needsKind, got.botCheck], ['needs_person', 'Datenschutzerklärung lesen und akzeptieren.', 'consent', false]);
  const sent = JSON.stringify(seen[0]);
  assert.ok(!sent.includes('me@example.com') && !sent.includes('SECRET'), 'no typed value and no query string reach the model');
  assert.ok(sent.includes('Datenschutzerklärung ist erforderlich'), 'the page\'s own error text does');
});

test('a control the page does not list is dropped; a bot check is reported; an answer outside the fixed ones is an error', async () => {
  assert.equal((await judgeAccount(fake({answer: 'needs_person', needs: 'Made-up control', bot_check: true, confidence: 0.8}), page, 'ready')).needs, '');
  assert.equal((await judgeAccount(fake({answer: 'ready', needs: '', bot_check: true, confidence: 0.8}), page, 'ready')).botCheck, true);
  assert.equal((await judgeAccount(fake({answer: 'created', needs: '', bot_check: false, confidence: 0.8}), page, 'ready')).error, 'not an answer');   // "created" is a result, not a readiness
  assert.equal((await judgeAccount(fake({answer: 'already_exists', needs: '', bot_check: false, confidence: 0.9}), page, 'result')).answer, 'already_exists');
  assert.equal((await judgeAccount(null, page, 'ready')).error, 'no AI');
});

test('the sketch keeps what the AI needs and drops what it must not see', () => {
  const sketch = accountSketch(page);
  assert.equal(sketch.path, '/career');
  assert.ok(!('value' in sketch.controls[0]));
  assert.equal(listed('E-MAIL-ADRESSE', sketch), 'E-Mail-Adresse');
});

test('after the press the AI tells a usable account from one that awaits a confirmation, and sees where the form was', async () => {
  const seen = [];
  const made = await judgeAccount(fake({answer: 'created_confirm', needs: '', needs_kind: '', bot_check: false, confidence: 0.9}, seen), {...page, fromPath: '/career'}, 'result');
  assert.equal(made.answer, 'created_confirm');
  assert.ok(JSON.stringify(seen[0]).includes('Address path before the press: /career'));
  assert.equal((await judgeAccount(fake({answer: 'created', needs: '', needs_kind: '', bot_check: false, confidence: 0.9}), page, 'result')).answer, 'created');
});

// One address for every step (SuccessFactors /career?career_ns=…, 9 Oct 2026 account eval): after a successful sign-in the AI saw the same path and said "refused".
// The extension now says whether the form's controls are the same as at the press; the AI sees it as a line, and only yes/no gets through.
test('after the press the AI is told whether the SAME form is back, not only the address', async () => {
  const seen = [];
  await judgeAccount(fake({answer: 'created', needs: '', needs_kind: '', bot_check: false, confidence: 0.9}, seen), {...page, fromPath: '/career', sameForm: 'no'}, 'result');
  assert.ok(JSON.stringify(seen[0]).includes('Same form as before the press (the same controls): no'));
  assert.match(seen[0].system, /same address alone never means the same form/);
  assert.equal(accountSketch({...page, sameForm: 'perhaps'}).sameForm, '');
  const quiet = [];
  await judgeAccount(fake({answer: 'created', needs: '', needs_kind: '', bot_check: false, confidence: 0.9}, quiet), page, 'result');
  assert.ok(!JSON.stringify(quiet[0]).includes('Same form'), 'no line when the extension did not compare');
});
