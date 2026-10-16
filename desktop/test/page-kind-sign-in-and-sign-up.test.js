// A sign-up form (a password and its verify box) and a sign-in form (one password) at the SAME address are asked apart: the sign-in must not take the sign-up's kept step.
// Richemont Workday, 16 Oct 2026: "Create Account" and "Sign In" share one address and the same counts of other fields; the sign-in form was answered "remembered: sign_up",
// so after the page's own switch the extension never signed in. The kept answer's key now tells one password box from two (ladder/rung1-kept.js pageBuild).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {kindKey, pageBuild, pageKind, pageKindCache} from '../lib/page-kind.js';

const URL_ = 'https://tenant.example.test/en-US/careers/job/City/Role_JR1/apply/applyManually';
const signUp = {url: URL_, title: 'Create Account', headings: ['Create Account'], buttons: ['Create Account'],
  controls: [{type: 'text', label: 'Email Address'}, {type: 'password', label: 'Password'}, {type: 'password', label: 'Verify New Password'}, {type: 'checkbox', label: 'I consent'}, {type: 'text', label: 'Enter website'}]};
const signIn = {url: URL_, title: 'Sign In', headings: ['Sign In'], buttons: ['Sign In'],
  controls: [{type: 'text', label: 'Email Address'}, {type: 'password', label: 'Password'}, {type: 'text', label: 'Enter website'}, {type: 'text', label: 'Enter website'}]};
const answering = (step, calls) => ({messages: {create: async request => { calls.push(request); return {stop_reason: 'end_turn', usage: {input_tokens: 600, output_tokens: 20},
  content: [{type: 'text', text: JSON.stringify({kind: 'account', confidence: 0.9, account_step: step})}]}; }}});
const cacheIn = () => pageKindCache(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-kind-')), 'page-kinds.json'));

test('one password box and two at the same address are different builds, so different kept answers', () => {
  assert.notEqual(pageBuild(signUp.controls), pageBuild(signIn.controls));
  assert.notEqual(kindKey(signUp), kindKey(signIn));
  assert.ok(pageBuild(signIn.controls).startsWith('p') && !pageBuild(signIn.controls).startsWith('pp'));   // a single password keeps the key it always had
  assert.ok(pageBuild(signUp.controls).startsWith('pp'));
});

test('the sign-in form after the sign-up form is asked, not answered with the sign-up step', async () => {
  const calls = [], cache = cacheIn();
  const first = await pageKind(answering('sign_up', calls), signUp, cache);
  const second = await pageKind(answering('sign_in', calls), signIn, cache);
  assert.deepEqual([first.accountStep, first.by, second.accountStep, second.by, calls.length], ['sign_up', 'ai', 'sign_in', 'ai', 2]);
  const again = await pageKind(answering('sign_in', calls), signUp, cache);   // the sign-up form itself is still remembered
  assert.deepEqual([again.accountStep, again.by, calls.length], ['sign_up', 'remembered', 2]);
});
