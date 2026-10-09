// The account-page eval's own plumbing (lib/account-eval.mjs), with no model: the fixture is consistent, every case runs through the app's own pageKind and judgeAccount,
// a model that gives each case's right answer scores 100% (so a case no model could pass, e.g. a button the app's validation drops, fails here), and one strict miss fails the run.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixtureProblems, loadCases, runAll, runJudge, runKind, score} from '../lib/account-eval.mjs';

const cases = loadCases();
const reply = answer => ({messages: {create: async () => ({stop_reason: 'end_turn', content: [{type: 'text', text: JSON.stringify(answer)}], usage: {input_tokens: 10, output_tokens: 10}})}});
const rightKind = item => reply({kind: item.expect.kind, confidence: 0.9, apply_button: item.expect.apply_button || '', account_step: item.expect.account_step || '', register_control: item.expect.register_control || '', signin_control: item.expect.signin_control || '', account_button: item.expect.account_button || ''});
const rightJudge = item => reply({answer: item.expect.answer || (item.expect.bot_check ? 'needs_person' : 'ready'), needs: item.expect.needs || '', needs_kind: item.expect.needs_kind || '', bot_check: !!item.expect.bot_check, confidence: 0.9});

test('the fixture is consistent: known answers, named controls on their page, unique ids, every language shape has a strict case', async () => {
  assert.deepEqual(await fixtureProblems(cases), []);
  assert.ok(cases.kind.length >= 10 && cases.judge.length >= 8, 'enough cases to mean something');
  for (const step of ['sign_in', 'sign_up', 'choose']) assert.ok(cases.kind.some(item => item.strict && item.expect.account_step === step), `a strict ${step} case`);
  for (const answer of ['refused', 'already_exists', 'created']) assert.ok(cases.judge.some(item => item.strict && item.expect.answer === answer), `a strict ${answer} case`);
  assert.ok(cases.judge.some(item => item.strict && item.expect.bot_check), 'a strict bot check case');
});

test('a model that gives every right answer scores 100% through the app\'s own validation', async () => {
  const rows = [...await Promise.all(cases.kind.map(item => runKind(rightKind(item), item))), ...await Promise.all(cases.judge.map(item => runJudge(rightJudge(item), item)))];
  assert.deepEqual(rows.filter(row => !row.right).map(row => `${row.id}: ${JSON.stringify(row.got)}`), []);
  assert.equal(score(rows).pass, true);
});

test('one strict case wrong fails the run even at a high share; no model at all fails every case', async () => {
  const item = cases.kind.find(entry => entry.expect.account_step === 'sign_in');
  const wrong = await runKind(reply({kind: 'account', confidence: 0.9, apply_button: '', account_step: 'sign_up', register_control: '', signin_control: '', account_button: item.expect.account_button}), item);
  assert.equal(wrong.right, false);
  assert.deepEqual(wrong.wrong.includes('account_step'), true);
  const rows = [wrong, ...Array.from({length: 40}, (_, index) => ({id: `ok${index}`, right: true, strict: false}))];
  assert.equal(score(rows).pass, false);
  assert.deepEqual(score(rows).strictWrong, [item.id]);
  const none = await runAll(null, cases);
  assert.equal(none.every(row => !row.right), true);
});
