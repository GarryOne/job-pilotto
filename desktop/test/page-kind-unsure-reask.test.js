// An unsure page-kind answer (error "unsure (0.3)", of ANY kind) is asked once more; a sure second answer wins, a still-unsure one leaves the first so the ladder climbs as before.
// Richemont Workday, 16 Oct 2026: the Sign In form came back "account-form" at 0.3 (with the right account_step) in two live runs; the answer was dropped and nothing was pressed.
// Guard for lib/ladder/rung2-sketch.js worthRetry (CLAUDE.md: a weak or missing AI answer is never kept as sure: it is asked again or climbs the ladder).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {KINDS, pageKind, pageKindCache} from '../lib/page-kind.js';

const signIn = {url: 'https://tenant.example.test/en-US/careers/job/City/Role_JR1/apply/applyManually', title: 'Sign In', headings: ['Role', 'Sign In'],
  controls: [{type: 'text', label: 'Email Address', required: true}, {type: 'password', label: 'Password', required: true}], buttons: ['Sign In', 'Create Account', 'Forgot your password?'], frames: [], mails: []};
const cacheIn = () => pageKindCache(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-kind-')), 'page-kinds.json'));
// A client that answers the given answers in order, and counts the asks.
const answering = (answers, calls) => ({messages: {create: async request => { calls.push(request); const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
  return {stop_reason: 'end_turn', usage: {input_tokens: 600, output_tokens: 20}, content: [{type: 'text', text: JSON.stringify(answer)}]}; }}});

test('the Sign In form: unsure first (account-form 0.3), sure second (account 0.93): the second wins and carries the sign_in step', async () => {
  const calls = [];
  const out = await pageKind(answering([{kind: 'account-form', confidence: 0.3, account_step: 'sign_in', account_button: 'Sign In'}, {kind: 'account', confidence: 0.93, account_step: 'sign_in', account_button: 'Sign In'}], calls), signIn, cacheIn());
  assert.deepEqual([out.kind, out.accountStep, out.accountButton, out.retried, out.error, calls.length], ['account', 'sign_in', 'Sign In', true, undefined, 2]);
});

test('every kind, unsure first: asked once more; a sure second answer wins, a still-unsure one leaves the first (never a third ask)', async () => {
  for (const kind of KINDS) {
    const unsureAnswer = {kind, confidence: 0.3}, sureAnswer = {kind, confidence: 0.9};
    const won = [];
    const second = await pageKind(answering([unsureAnswer, sureAnswer], won), signIn, cacheIn());
    assert.deepEqual([second.kind, second.error, second.retried, won.length], [kind, undefined, true, 2], `${kind}: a sure second answer wins`);
    const calls = [];
    const stillUnsure = await pageKind(answering([unsureAnswer, unsureAnswer], calls), signIn, cacheIn());
    assert.ok(stillUnsure.error?.startsWith('unsure'), `${kind}: still unsure after the re-ask: the ladder climbs`);
    assert.equal(calls.length, 2, `${kind}: exactly one re-ask`);
  }
});

test('a sure first answer is asked once, and a digest ask is never re-asked', async () => {
  const sure = [];
  await pageKind(answering([{kind: 'account', confidence: 0.93, account_step: 'sign_in'}], sure), signIn, cacheIn());
  assert.equal(sure.length, 1);
  const digest = [];
  const out = await pageKind(answering([{kind: 'account', confidence: 0.3}], digest), {...signIn, candidates: [{n: 1, kind: 'button', text: 'Sign In', position: 'main'}]}, cacheIn(), {digest: true});
  assert.ok(digest.length <= 1, `a digest ask is not re-asked (${digest.length} asks, ${out.error || out.kind})`);
});
