// "cases fail before the fix" (once "hole 3") of the recorded-case gate (tools/recorded-fails-on-old.mjs): a case the push brings must FAIL on the code before it; a pin says so, a fix cannot.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {outcomes, splitPinned, unreadKeys, verdict} from '../../tools/recorded-fails-on-old.mjs';

const commit = (files, message = '') => ({files, message});

test('the push\'s cases are split into the ones that must fail on the old code and the ones a commit says only pin behaviour', () => {
  const split = splitPinned([commit(['desktop/e2e/recorded/a-1/case.json', 'extension/page/radios.js'], 'Fix\n\nPool-row: X'), commit(['desktop/e2e/recorded/b-1/case.json'], 'Pin it\n\nRecorded-pins: the menu already worked')]);
  assert.deepEqual(split, {pinned: ['b-1'], check: ['a-1'], refused: [], fixOf: {}});
  // A pin that names a failure it fixes is no pin: the case is checked and the pin is refused.
  assert.deepEqual(splitPinned([commit(['desktop/e2e/recorded/c-1/case.json'], 'Fix\n\nRecorded-pins: x\nFixes #5')]), {pinned: [], check: ['c-1'], refused: ['c-1'], fixOf: {}});
  assert.deepEqual(splitPinned([commit(['extension/log.js'])]), {pinned: [], check: [], refused: [], fixOf: {}});
});

test('a follow-up to a fix already on main names it, and its cases are replayed on the code before that fix', () => {
  // 12 Oct 2026, PRs #374 and #386: the case of a merged fix was tightened later; on the PR's base (which has the fix) it passed, and hole 3 said "proves nothing".
  const fix = 'c66b42a1f00d';
  const split = splitPinned([commit(['desktop/e2e/recorded/phone-1/case.json'], `Tighten the case\n\nPool-row: Recruitee\nFix-commit: ${fix}`)]);
  assert.deepEqual(split.check, ['phone-1']);
  assert.deepEqual(split.refused, []);
  assert.deepEqual(split.fixOf, {'phone-1': fix});
  // With Fix-commit the case is proven, so a Recorded-pins beside it is not a refused escape.
  assert.deepEqual(splitPinned([commit(['desktop/e2e/recorded/p-1/case.json'], `x\n\nRecorded-pins: tightened\nPool-row: X\nFix-commit: ${fix}`)]).refused, []);
  // Without it, the case is checked on the PR's base, as before.
  assert.deepEqual(splitPinned([commit(['desktop/e2e/recorded/a-1/case.json'], 'Fix\n\nPool-row: X')]).fixOf, {});
  assert.match(verdict({passed: ['phone-1'], missing: []}), /Fix-commit: <sha>/, 'the refusal names the way out for a follow-up');
});

test('a case that passes on the old code, or gives no result, is refused; one that fails there is accepted', () => {
  const tap = 'ok 1 - menu-1: Menus\nnot ok 2 - radios-1: Radios\n  ---\n  error: x\nok 3 - recorded: other';
  const found = outcomes(['menu-1', 'radios-1', 'ghost-1'], tap);
  assert.deepEqual(found, {failed: ['radios-1'], passed: ['menu-1'], missing: ['ghost-1']});
  assert.match(verdict(found), /menu-1 PASSES on the code before this push/);
  assert.match(verdict(found), /no result for ghost-1/);
  assert.equal(verdict(outcomes(['radios-1'], tap)), '');
  assert.deepEqual(outcomes(['menu-1'], '\u001b[32m✔ menu-1: Menus\u001b[39m').passed, ['menu-1']);
  assert.deepEqual(outcomes(['menu'], tap).missing, ['menu'], 'a case name is not matched by its prefix');
});

test('the check runs as a script (a CI job on a branch/PR, or by hand), not from the push hook', () => {
  assert.ok(fs.existsSync(new URL('../../tools/recorded-fails-on-old.mjs', import.meta.url)));
});

test('a check the PR adds to the replay is named when main\'s replay cannot read it, not a silent "proves nothing"', () => {
  // 12 Oct 2026, #516: sign-in-then-form-1 checked only `stuck` and `ending`, new in that PR's page-replay.mjs; main's replay skipped both and the case "passed on the old code".
  const oldReplay = "const expect = item.expect || {}, deadline = expect.seconds || 40;\nfor (const word of expect.notTold || []) x();\n// a comment naming ending and stuck does not count\nconst checks = {told: 1, filled: 2};";
  assert.deepEqual(unreadKeys({told: ['a'], stuck: 'x', ending: 'handed', seconds: 9}, [oldReplay]), ['ending', 'stuck'], 'only the keys main never reads; a word in a comment does not count');
  assert.deepEqual(unreadKeys({told: ['a'], notTold: ['b']}, [oldReplay]), []);
  const why = verdict({passed: ['sign-in-then-form-1'], missing: []}, {'sign-in-then-form-1': ['ending', 'stuck']});
  assert.match(why, /main's replay cannot check: ending, stuck/);
  assert.match(why, /add a check it knows/);
  assert.doesNotMatch(verdict({passed: ['a-1'], missing: []}, {}), /cannot check/, 'no note when every key is read');
});
