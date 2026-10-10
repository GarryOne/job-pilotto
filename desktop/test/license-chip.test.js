// The sidebar counter ("Free plan · 12 of 20 applications used"): the plan, the words, the bar (what is used, filling, red for the last 5) and the tone for
// each situation the allowance can be in.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chip} from '../renderer/license-chip.js';

const state = (extra = {}) => ({licensed: false, ended: false, used: 12, limit: 20, daysLeft: 41, ...extra});

test('while the allowance lasts it names the plan and says how many of the free applications are used, with a bar that fills', () => {
  const shown = chip(state());
  assert.deepEqual([shown.plan, shown.text, shown.tone, shown.percent], ['Free plan', '12 of 20 applications used', 'info', 60]);
  assert.match(shown.title, /Free plan: 12 of 20 applications used · 41 days left/);
  assert.match(shown.title, /whichever comes later/);
  assert.match(shown.title, /license key lifts the limit/);
  assert.equal(chip(state({used: 19})).text, '19 of 20 applications used');
  assert.equal(chip(state({used: 0})).percent, 2, 'an empty bar still shows');
  assert.equal(chip(state({used: 20, daysLeft: 3})).percent, 100);
});

test('the bar is blue until the last 5 applications are left, then red (whatever the days)', () => {
  assert.equal(chip(state({used: 14, daysLeft: 20})).tone, 'info');
  assert.equal(chip(state({used: 15, daysLeft: 20})).tone, 'bad');
  assert.equal(chip(state({used: 17, daysLeft: 0})).tone, 'bad');
  assert.equal(chip(state({used: 45, daysLeft: 3})).text, '20 of 20 applications used', 'never past the limit');
});

test('past the allowance it says so plainly, and a licensed install shows no counter at all', () => {
  const over = chip(state({ended: true, used: 41, daysLeft: 0}));
  assert.deepEqual([over.plan, over.text, over.tone, over.percent], ['Free plan', 'Free period over', 'bad', 100]);
  assert.match(over.title, /Tracking, Notion and export keep working/);
  assert.equal(chip(state({licensed: true})), null);
  assert.equal(chip(null), null);
});

test('Settings → License counts the same thing as the chip: applications used, from the chip', async () => {
  const {readFile} = await import('node:fs/promises');
  const page = await readFile(new URL('../renderer/pages/license.js', import.meta.url), 'utf8');
  assert.match(page, /\$\{shown\.used\} of \$\{state\.limit\}/, 'the Settings number is the chip\'s used');
  assert.match(page, /style\.width = `\$\{shown\.percent\}%`/, 'the Settings bar is the chip\'s filling bar');
  assert.doesNotMatch(page, /state\.used \/ state\.limit/, 'no second, filling bar');
  assert.deepEqual([chip(state({used: 0})).used, chip(state({used: 12})).used, chip(state({used: 50})).used], [0, 12, 20]);
});
