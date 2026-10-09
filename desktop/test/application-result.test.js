// How an application ended, as one fixed word (lib/application-result.js): submitted clean / assisted / by Claude, or failed and where; cancelled and restarted sessions count for nothing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {RESULT_STATES, resultOf} from '../lib/application-result.js';
import {FLOW_STATES, createReporter} from '../lib/recipes.js';
import * as terminals from '../lib/terminals.js';

const form = extra => ({kind: 'form', outcome: 'submitted', stuck: '', ...extra});

test('submitted: clean when you changed nothing, assisted when you filled a field yourself, by Claude when Claude finished it', () => {
  assert.equal(resultOf(form(), {filled: [{label: 'Name', by: 'fill'}, {label: 'Email', by: 'fill'}]}), 'submitted-clean');
  assert.equal(resultOf(form(), {filled: [{label: 'Name', by: 'fill'}, {label: 'Phone', by: 'you'}]}), 'submitted-assisted');
  assert.equal(resultOf(form(), undefined), 'submitted-clean');
  assert.equal(resultOf({kind: 'claude', outcome: 'submitted'}, undefined), 'submitted-claude');
});

test('not submitted: failed where the extension stopped (no form, the account step), else abandoned; cancelled, restarted or undecided sessions count for nothing', () => {
  assert.equal(resultOf(form({outcome: 'not submitted', stuck: 'no-form'})), 'failed-no-form');
  assert.equal(resultOf(form({outcome: 'not submitted', stuck: 'account'})), 'failed-account');
  assert.equal(resultOf(form({outcome: 'not submitted'})), 'failed-abandoned');
  for (const outcome of ['cancelled', 'restarted', '']) assert.equal(resultOf(form({outcome})), '');
  assert.equal(resultOf({kind: 'other', outcome: 'submitted'}), '');
});

test('every word is one the shared counts accept, and each is a plain fixed word (no personal data can ride on it)', () => {
  for (const word of RESULT_STATES) { assert.ok(FLOW_STATES.includes(word)); assert.match(word, /^[a-z]+(-[a-z]+)+$/); }
});

test('deciding how an application ended tells the listener once, with only the fields the statistics need', () => {
  const heard = [];
  terminals.onOutcome(item => heard.push(item));
  terminals.startForm({id: 'r1', url: 'https://jobs.example.ch/job/1'});
  terminals.noteStuck('r1', 'account', 'auth.example.ch', 'Log in');
  terminals.setOutcome('r1', 'not submitted');
  assert.deepEqual(heard.map(item => [item.id, item.kind, item.outcome, item.stuck, item.accountHost]), [['r1', 'form', 'not submitted', 'account', 'auth.example.ch']]);
  terminals.setOutcome('r1', '');
  assert.equal(heard.length, 1);   // clearing a decision is not an application's end
  terminals.onOutcome(() => {});
});

test('the shared counts send a result like any other flow word, per board', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-result-'));
  const storage = {settings: () => ({telemetry: true}), readText: () => '', saveSettings() {}, secret: () => '', path: name => path.join(dir, name), dir};
  const sent = [];
  const reporter = createReporter(storage, {fetcher: async (url, init) => { sent.push(JSON.parse(init.body)); return {ok: true, status: 200, json: async () => ({})}; }, setTimer: () => ({unref() {}})});
  reporter.flow('h:0123456789', 'submitted-assisted');
  reporter.flow('h:0123456789', 'submitted-assisted');
  reporter.flow('h:0123456789', 'made-up');   // not a fixed word: dropped
  await reporter.flush();
  assert.deepEqual(sent.at(-1).flows, [{board: 'h:0123456789', state: 'submitted-assisted', n: 2}]);
});
