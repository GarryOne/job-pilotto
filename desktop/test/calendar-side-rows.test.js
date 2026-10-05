// Calendar: chips use the same solid stage colours as the legend; side rows are date | company, job, stage; counts and empty states.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = name => fs.readFileSync(new URL(`../renderer/${name}`, import.meta.url), 'utf8');

test('chips and legend dots share the solid stage colours', () => {
  const css = read('style.css');
  assert.match(css, /\.cal-chip \{ background: var\(--info\)/);
  assert.match(css, /\.cal-chip\.kind-screening \{ background: var\(--teal\)/);
  assert.match(css, /\.cal-legend \.dot\.kind-screening \{ background: var\(--teal\)/);
});

test('side rows: date column, stage in its kind colour, count badge and compact empty state', () => {
  const page = read('pages/calendar.js');
  assert.match(page, /cal-stage kind-\$\{m\.kind\}/);
  assert.match(page, /cal-past-count/);
  assert.match(page, /const empty = /);
  assert.match(read('index.html'), /id="cal-past-count"/);
});
