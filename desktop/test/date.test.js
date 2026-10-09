// The screens' one date format (renderer/date.js): "8 Oct", the year only when it isn't this year (owner, 9 Oct 2026).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {shortDay} from '../renderer/date.js';

const NOW = Date.parse('2026-10-09T10:00:00');

test('a date this year has no year, another year has it, and an unreadable value is empty', () => {
  assert.equal(shortDay('2026-10-08', NOW), '8 Oct');
  assert.equal(shortDay('2026-09-28T18:40:00+00:00', NOW), '28 Sept');
  assert.equal(shortDay('2025-03-01', NOW), '1 Mar 2025');
  assert.equal(shortDay('', NOW), '');
  assert.equal(shortDay('not a date', NOW), '');
});
