// The sidebar counter ("28 free applications left"): the words, the bar and the tone for each situation the allowance can be in.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chip} from '../renderer/license-chip.js';

const state = (extra = {}) => ({licensed: false, ended: false, used: 12, limit: 40, daysLeft: 41, ...extra});

test('while the allowance lasts it says how many free applications are left, with a bar for the share used', () => {
  const shown = chip(state());
  assert.deepEqual([shown.text, shown.tone, shown.percent], ['28 free applications left', 'info', 30]);
  assert.match(shown.title, /12 of 40 free applications · 41 days left/);
  assert.match(shown.title, /whichever comes later/);
  assert.equal(chip(state({used: 39})).text, '1 free application left');
  assert.equal(chip(state({used: 0})).percent, 2, 'an empty bar still shows');
});

test('the tone turns to a warning only when few are left and the free days are used up', () => {
  assert.equal(chip(state({used: 37, daysLeft: 20})).tone, 'info');       // few left, but days remain: no alarm
  assert.equal(chip(state({used: 37, daysLeft: 0})).tone, 'warn');
  assert.equal(chip(state({used: 45, daysLeft: 3})).text, '0 free applications left');
});

test('past the allowance it says so plainly, and a licensed install shows no counter at all', () => {
  const over = chip(state({ended: true, used: 41, daysLeft: 0}));
  assert.deepEqual([over.text, over.tone, over.percent], ['Free period over', 'warn', 100]);
  assert.match(over.title, /Tracking, Notion and export keep working/);
  assert.equal(chip(state({licensed: true})), null);
  assert.equal(chip(null), null);
});
