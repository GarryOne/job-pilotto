// Hole 3 of the recorded-case gate (tools/recorded-fails-on-old.mjs): a case the push brings must FAIL on the code before it; a pin says so, a fix cannot.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {outcomes, splitPinned, verdict} from '../../tools/recorded-fails-on-old.mjs';

const commit = (files, message = '') => ({files, message});

test('the push\'s cases are split into the ones that must fail on the old code and the ones a commit says only pin behaviour', () => {
  const split = splitPinned([commit(['desktop/e2e/recorded/a-1/case.json', 'extension/page/radios.js'], 'Fix\n\nPool-row: X'), commit(['desktop/e2e/recorded/b-1/case.json'], 'Pin it\n\nRecorded-pins: the menu already worked')]);
  assert.deepEqual(split, {pinned: ['b-1'], check: ['a-1'], refused: []});
  // A pin that names a failure it fixes is no pin: the case is checked and the pin is refused.
  assert.deepEqual(splitPinned([commit(['desktop/e2e/recorded/c-1/case.json'], 'Fix\n\nRecorded-pins: x\nFixes #5')]), {pinned: [], check: ['c-1'], refused: ['c-1']});
  assert.deepEqual(splitPinned([commit(['extension/log.js'])]), {pinned: [], check: [], refused: []});
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
