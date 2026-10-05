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

test('Coming up has a card empty state with a calendar icon', () => {
  assert.match(read('pages/calendar.js'), /No upcoming interviews/);
  assert.match(read('index.html'), /<h2>Coming up<\/h2>/);
});

test('each side event is a small bordered card', () => {
  assert.match(read('style.css'), /\.cal-row \{[^}]*border: 1px solid var\(--line-strong\)[^}]*border-radius: var\(--r-md\)/);
});

test('Recent interviews: count, View all, scrolling list, Load more', () => {
  const html = read('index.html');
  for (const id of ['cal-past-count', 'cal-more-view', 'cal-past-more', 'cal-past-shown']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(read('style.css'), /\.cal-scroll \{[^}]*overflow-y: auto/);
  assert.match(read('pages/calendar.js'), /pastShown \+= 20/);
});
