// The decision-branch ratchet (tools/decision-branches.mjs; spec 2026-10-12-one-next-move.md phase 3, owner 12 Oct 2026: "a decision is data"): the page-kind/role conditions in
// consider() and the account step may only go down; a new one is a fixture or a learned move, or the owner's OK said in the baseline's reason.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {BASELINE_FILE, CONDITION, PLACES, bodyOf, counts, countIn, nextBaseline, verdict} from '../../tools/decision-branches.mjs';

test('the flow\'s decision code has no more page-kind/role conditions than the baseline, and no fewer left unlocked', () => {
  const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  assert.equal(verdict(counts(), baseline.counts), '');
});

test('each place is found (a rename never makes the count silently zero), and its conditions are counted', () => {
  const now = counts();
  for (const place of PLACES) assert.ok(now[place.name] > 0, `${place.file}: ${place.head} not found or no condition read`);
});

test('a condition is a role, kind, step, mode or answer compared with one of our words; a comment naming one is not counted', () => {
  const source = `function x() {}\nexport async function consider(tab) {\n  if (role === 'form') go();   // role === 'account' in a comment\n  if (kind?.role !== 'no-form' && step === 'sign_in') stop();\n  const y = {a: 1};\n  if (answer.mode === 'sign-up') z();\n}\nconst after = role === 'form';`;
  assert.equal(countIn(source, 'export async function consider('), 4);
  assert.match(bodyOf(source, 'export async function consider('), /answer\.mode/);
  assert.doesNotMatch(bodyOf(source, 'export async function consider('), /after/);
  assert.equal("x === 'form'".match(CONDITION), null, 'only the decision words');
});

test('more conditions fail with the rule; fewer must lock the gain; a raise needs the owner\'s reason', () => {
  assert.match(verdict({consider: 22, accountStep: 15}, {consider: 21, accountStep: 15}), /a decision is data: add a fixture or a learned move, or say why in "Decision-branch: <why>" \(owner's OK\)/);
  assert.match(verdict({consider: 20, accountStep: 15}, {consider: 21, accountStep: 15}), /lock the gain/);
  const before = {counts: {consider: 21, accountStep: 15}, reasons: [{date: '2026-10-12', reason: 'first'}]};
  assert.throws(() => nextBaseline({consider: 22, accountStep: 15}, before, 'one more branch'), /Decision-branch:/);
  assert.deepEqual(nextBaseline({consider: 22, accountStep: 15}, before, 'Decision-branch: a safety floor, owner OK 14 Oct', '2026-10-14').reasons.at(-1), {date: '2026-10-14', reason: 'Decision-branch: a safety floor, owner OK 14 Oct'});
  assert.deepEqual(nextBaseline({consider: 20, accountStep: 15}, before, 'a branch became data', '2026-10-14').counts, {consider: 20, accountStep: 15});
  assert.throws(() => nextBaseline({consider: 20, accountStep: 15}, before, ' '), /reason/);
});
