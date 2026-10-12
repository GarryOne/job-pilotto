// The applying scenarios as event sequences (spec: docs/superpowers/specs/2026-10-10-application-journey.md): what the extension reports, in order,
// through the app's real path (session-flow.js -> terminals.js -> lib/application-journey.js), and the one step the card must show. Seconds, no browser.
// A live bug becomes one scenario here, failing first. The push hook runs this file when a flow-core file changed (tools/journey-gate.mjs).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as terminals from '../lib/terminals.js';
import * as apply from '../lib/apply.js';
import {createSessionFlow} from '../lib/session-flow.js';
import {createAccountCheck} from '../lib/account-check.js';
import {journeyStep} from '../lib/application-journey.js';
import {accountRecordLine} from '../renderer/session-state.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {decidePageKind} from '../lib/server-pages.js';

const POSTING = 'https://www.jobs.ch/en/vacancies/detail/12181ac1/', SIGNIN = 'https://auth.jobs.ch/u/login/identifier', FORM = 'https://apply.example/form';
function journeyOf(id = 'f1') {
  terminals._reset();
  terminals.startForm({id, url: POSTING, company: 'Deloitte'});
  const review = {olderTab: () => false, allStates: () => [], queueClose: () => {}};
  const flow = createSessionFlow({terminals, review, apply, appLog: () => {}, toWindow: () => {}, startClaude: async () => ({ok: true}), claudeAllowed: () => false, closeTab: async () => true});
  const card = () => journeyStep(terminals.get(id));
  return {flow, card, id};
}

test('scenario: posting -> sign-in page -> a "no form" from the posting tab left behind: the card stays at the account step (10 Oct 2026)', () => {
  const {flow, card} = journeyOf();
  flow.reported({id: 'f1', url: SIGNIN, total: 1, left: 1, account: true});
  assert.equal(card().step, 'account');
  flow.stuck({url: POSTING, host: 'www.jobs.ch', why: 'no-form', session: 'f1'});
  assert.deepEqual(card(), {step: 'account', needs: ''});
  assert.notEqual(terminals.get('f1').note, 'The extension can\'t reach the form');
});

test('scenario: sign-up pressed, the account awaits its mail, the mail holds a code: the card says confirm and what the person must do', async () => {
  const {card} = journeyOf();
  terminals.setStage('f1', 'account', 'auth.jobs.ch');
  terminals.setAccount('f1', 'confirm');
  const check = createAccountCheck({confirm: async () => 'code', noteStuck: (...args) => terminals.noteStuck(...args), log: () => {}});
  assert.equal(await check({host: 'auth.jobs.ch', email: 'me@example.com', session: 'f1', force: true}), 'code');
  assert.equal(card().step, 'confirm');
  assert.match(card().needs, /code/i);
});

test('scenario: a pending account with no mail found: the person is still told (never a silent page)', async () => {
  const {card} = journeyOf();
  terminals.setAccount('f1', 'confirm');
  const check = createAccountCheck({confirm: async () => 'none', noteStuck: (...args) => terminals.noteStuck(...args), log: () => {}});
  await check({host: 'auth.jobs.ch', email: 'me@example.com', session: 'f1', force: true});
  assert.equal(card().step, 'confirm');
  assert.ok(card().needs.length > 0);
});

test('scenario: account step, then the form behind it: the form step, the account site kept for "step 2 of 2"', () => {
  const {flow, card} = journeyOf();
  flow.reported({id: 'f1', url: SIGNIN, total: 1, left: 1, account: true});
  flow.reported({id: 'f1', url: FORM, total: 9, left: 4});
  assert.equal(card().step, 'form');
  assert.equal(terminals.get('f1').accountHost, 'auth.jobs.ch');
});

test('scenario: a fill that put nothing in stays "needs you" until something is filled (c1a2fcc)', () => {
  const {flow, card} = journeyOf();
  flow.reported({id: 'f1', url: FORM, total: 3, left: 3});
  flow.stuck({url: FORM, host: 'apply.example', why: 'incomplete', session: 'f1', needs: 'Nothing could be filled'});
  flow.reported({id: 'f1', url: FORM, total: 3, left: 3});
  assert.equal(terminals.get('f1').stuck, 'incomplete');
  flow.reported({id: 'f1', url: FORM, total: 3, left: 1});
  assert.equal(terminals.get('f1').stuck, '');
  assert.equal(card().step, 'form');
});

test('scenario: no form and no Apply on the posting itself: the card says the extension cannot reach the form', () => {
  const {flow, card} = journeyOf();
  flow.stuck({url: POSTING, host: 'www.jobs.ch', why: 'no-form', session: 'f1'});
  assert.equal(card().step, 'posting');
  assert.match(card().needs, /can't reach/);
});

test('scenario: a sign-in tab that carries no session id: the app finds the application by the tab\'s job, so "enter the code" reaches its card (10 Oct 2026)', async () => {
  const {card} = journeyOf();
  const {resolveSession} = await import('../lib/journey-identity.js');
  const session = resolveSession({session: '', job: POSTING, url: SIGNIN}, {get: terminals.get, list: terminals.list, isFormOf: apply.isFormOf});
  assert.equal(session, 'f1');
  terminals.setAccount(session, 'confirm');
  const check = createAccountCheck({confirm: async () => 'code', noteStuck: (...args) => terminals.noteStuck(...args), log: () => {}});
  await check({host: 'auth.jobs.ch', email: 'me@example.com', session, force: true});
  assert.equal(card().step, 'confirm');
  assert.match(card().needs, /code/i);
});

test('scenario: the confirmation page asks for the mailed code: in "Do it for me" the app reads it and hands it to the extension; in "Let me check each step" the person types it (10 Oct 2026)', async () => {
  const {accountCodeAnswer, codeFromMail} = await import('../lib/account-confirm.js');
  const logs = [];
  const read = found => codeFromMail({...found, run: async () => ({code: 0, stdout: JSON.stringify({code: '482913', links: []})}), log: (...line) => logs.push(JSON.stringify(line))});
  assert.deepEqual(await accountCodeAnswer({mode: 'full', host: 'auth.jobs.ch', email: 'me@example.com', read}), {ok: true, code: '482913'});
  assert.equal((await accountCodeAnswer({mode: 'assist', host: 'auth.jobs.ch', email: 'me@example.com', read})).ok, false);
  assert.equal((await accountCodeAnswer({mode: 'full', host: 'auth.jobs.ch', email: '', read})).ok, false);
  assert.ok(logs.length && !logs.join(' ').includes('482913'), 'the code is never logged');
  const none = found => codeFromMail({...found, run: async () => ({code: 1, stdout: '{"error": "no confirmation email yet"}'}), log: () => {}});
  assert.deepEqual(await accountCodeAnswer({mode: 'full', host: 'h.example', email: 'me@example.com', read: none}), {ok: false, why: 'no code in the mail'});
});

test('scenario: a sign-up accepts the required terms, is created, and the code from the mail is typed: the card keeps a record of it (10 Oct 2026)', () => {
  const {flow, card} = journeyOf();
  flow.reported({id: 'f1', url: SIGNIN, total: 3, left: 3, account: true});
  terminals.setAccountFact('f1', 'terms', 'I accept the terms of use');
  terminals.setAccount('f1', 'confirm');
  terminals.setAccountFact('f1', 'code');
  terminals.setAccount('f1', 'created');
  const item = terminals.get('f1');
  assert.deepEqual([item.accountTerms, item.accountCode, item.accountState], [['I accept the terms of use'], true, 'created']);
  assert.equal(accountRecordLine(item).includes('terms accepted: ‘I accept the terms of use’'), true);
  assert.equal(card().step !== 'ended', true);
});

test('scenario: a posting that asks for the application by email: the card says where to send it, never "can\'t reach the form", and Claude is not offered', () => {
  const {flow, card} = journeyOf();
  flow.stuck({url: POSTING, host: 'www.jobs.ch', why: 'email', needs: 'jobs@firma.ch', session: 'f1'});
  assert.deepEqual(card(), {step: 'posting', needs: 'Send your application to jobs@firma.ch'});
  assert.equal(terminals.get('f1').stuck, 'email');
  flow.stuck({url: POSTING, host: 'www.jobs.ch', why: 'no-form', session: 'f1'});   // the same page reported again by the structure rule: the email stays
  assert.equal(terminals.get('f1').stuck, 'email');
});

test('scenario: an email posting reported from a tab the application has left (its sign-in tab) never takes the account step back', () => {
  const {flow, card} = journeyOf();
  flow.reported({id: 'f1', url: SIGNIN, total: 1, left: 1, account: true});
  flow.stuck({url: POSTING, host: 'www.jobs.ch', why: 'email', needs: 'jobs@firma.ch', session: 'f1'});
  assert.equal(card().step, 'account');
});

test('scenario: a posting that tells the person to call: the card quotes the page\'s sentence, never "can\'t reach the form", and Claude is not offered', () => {
  const {flow, card} = journeyOf();
  flow.stuck({url: POSTING, host: 'www.jobs.ch', why: 'told', needs: 'Rufen Sie uns an: 044 555 01 00', session: 'f1'});
  assert.deepEqual(card(), {step: 'posting', needs: 'The page says: Rufen Sie uns an: 044 555 01 00'});
  assert.equal(terminals.get('f1').stuck, 'told');
});

test('scenario: the ladder ends with no usable answer (other): the card says Job Pilotto could not tell how to apply, never "can\'t reach the form", and Claude is not offered', () => {
  const {flow, card} = journeyOf();
  flow.stuck({url: POSTING, host: 'www.jobs.ch', why: 'other', session: 'f1'});
  assert.deepEqual(card(), {step: 'posting', needs: 'Job Pilotto could not tell how to apply: open the page'});
  assert.equal(terminals.get('f1').stuck, 'other');
});

// 12 Oct 2026 (jobs.ch "Create an account to apply faster" left open): through the app's own page-kind route, the first answer over the layer is "0.6, no route" (what the live run got) and
// the second names the manual route: the extension must be told the route (it presses "Continue without an account", start-route.js). Today's hold: no route.
test('scenario: a layer offers "continue without an account", the first answer is unsure with no route: the route still reaches the extension (jobs.ch, 12 Oct 2026)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-journey-kind-'));
  const storage = {path: name => path.join(dir, name), settings: () => ({})};
  const noWay = {kind: 'posting', confidence: 0.6, apply_button: '', apply_button_kind: '', apply_route: '', apply_by: 'other', apply_email: '', form_frame: -1, account_step: '', register_control: '', signin_control: '', account_button: '', bot_check: false};
  const manual = {...noWay, confidence: 0.85, apply_button: 'Continue without an account', apply_button_kind: 'apply', apply_route: 'manual', apply_by: 'form'};
  let asked = 0;
  const client = {messages: {create: async () => ({stop_reason: 'end_turn', usage: {input_tokens: 10, output_tokens: 5}, content: [{type: 'text', text: JSON.stringify(asked++ ? manual : noWay)}]})}};
  const layer = ['Login here', 'Create an account', 'Continue without an account'];
  const body = {url: POSTING, title: 'Real Estate Accountant', headings: ['Create an account to apply faster', 'Real Estate Accountant'], controls: [], buttons: [...layer, 'Login', 'Saved jobs'],
    noEffect: ['Easy apply'], fresh: true, onTop: {shape: 'overlay', role: 'div', text: 'Create an account to apply faster', buttons: layer}};
  const answer = await decidePageKind(storage, body, {client});
  assert.deepEqual([answer.applyRoute, answer.applyButton], ['manual', 'continue without an account']);
  assert.equal(asked, 2, 'one retry, no more');
});

// 12 Oct 2026 (Ocado, CI): a user on the Anthropic API engine asks the digest (rung 3, an unsure posting); the API refuses a schema that carries maxItems (400), so the digest
// fell to "page kind: none (400 ...)" and the ladder ended at the person. Through the app's own page-kind route and the real API adapter over an SDK that refuses limits like the API.
test('scenario: a digest request on the Anthropic API engine is answered, not refused for the list limit in its schema (Ocado, 12 Oct 2026)', async () => {
  const {AnthropicApi} = await import('../lib/ai/anthropic-api.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-journey-digest-'));
  const storage = {path: name => path.join(dir, name), settings: () => ({})};
  const refusing = {messages: {create: async body => {
    if (/maxItems|minItems/.test(JSON.stringify(body.output_config))) throw Object.assign(new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"output_config.format.schema: For \'array\' type, property \'maxItems\' is not supported"}}'), {status: 400});
    return {stop_reason: 'end_turn', usage: {input_tokens: 700, output_tokens: 30}, content: [{type: 'text', text: JSON.stringify({outcome: 'phone', verb: 'tell_person', numbers: [1], press_kind: '', confidence: 0.9})}]};
  }}};
  const candidates = [{n: 1, kind: 'phone', position: 'main', text: '044 555 01 00'}, {n: 2, kind: 'sentence', position: 'main', text: 'Fragen? Rufen Sie uns an'}];
  const body = {url: POSTING, title: 'Real Estate Accountant', headings: ['Real Estate Accountant'], controls: [], buttons: ['Login'], candidates, digest: true, fresh: true};
  const answer = await decidePageKind(storage, body, {client: new AnthropicApi({sdk: refusing})});
  assert.equal(answer.by, 'digest', JSON.stringify(answer).slice(0, 300));
  assert.equal(answer.digest?.outcome, 'phone');
});

test('scenario: Notion chosen but not connected, a search starts: the engine runs as while trying, never on a Notion store with no token (#410)', async () => {
  const {pipelineEnv} = await import('../lib/pipeline.js');
  const storage = settings => ({settings: () => settings, secret: () => '', path: name => `/folder/${name}`, secretsPresent: () => ({}), saveSettings: () => {}});
  const env = pipelineEnv(storage({store: 'notion'}), {PATH: '/usr/bin'});
  assert.equal(env.JOB_PILOTTO_STORE, undefined);   // was 'notion': src/stores/notion.py raised "needs NOTION_TOKEN", shown as "Unexpected error"
  assert.equal(env.NOTION_TOKEN, undefined);
});

test('scenario: account permission handoff and partial application never claim review completion', async () => {
  const {sessionReview, sessionState} = await import('../renderer/session-state.js');
  const {flow} = journeyOf();
  flow.stuck({url: POSTING, host: 'accounts.example', why: 'account', session: 'f1', needs: 'Continue needs permission'});
  terminals.report('f1', {event: 'input', message: 'Continue was blocked by a permission check. Nothing was submitted.'});
  assert.equal(sessionReview(terminals.get('f1'), true), false);
  assert.notEqual(sessionState(terminals.get('f1'), true)[0], 'Ready to submit');
  const partial = {kind: 'form', status: 'done'};
  assert.equal(sessionReview(partial, false), false);
  assert.deepEqual(sessionState(partial, false), ['Form open', 'info']);
  assert.deepEqual(sessionState(partial, true), ['Ready to submit', 'good']);
});
