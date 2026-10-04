// Calendar chips: the time sits on its own line so the event name keeps the full width (issue #123).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const page = readFileSync(new URL('../renderer/pages/calendar.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../renderer/style.css', import.meta.url), 'utf8');

test('a chip shows the time and the name as separate lines', () => {
  assert.match(page, /cal-chip-time/);
  assert.match(page, /cal-chip-name/);
});

test('the chip name has its own ellipsis rule', () => {
  assert.match(css, /\.cal-chip-name\s*\{[^}]*text-overflow: ellipsis/);
});
