// Counters flash when they change (owner, 7 Oct 2026), through one helper for every counter of the Jobs page and its menu badge.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

test('every Jobs counter and the menu badge go through setCount', () => {
  const jobs = fs.readFileSync(new URL('../renderer/pages/jobs.js', import.meta.url), 'utf8');
  for (const id of ['stat-total', 'stat-high', 'stat-inbound', 'stat-companies', 'nav-jobs-badge']) {
    assert.match(jobs, new RegExp(`setCount\\(\\$\\('${id}'\\)`), id);
    assert.doesNotMatch(jobs, new RegExp(`\\$\\('${id}'\\)\\.textContent =`), `${id} set without the flash`);
  }
  assert.match(jobs, /setCount\(\$\(`stat-\$\{kind\}`\)/, 'the application counters too');
  const css = fs.readFileSync(new URL('../renderer/components.css', import.meta.url), 'utf8');
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.count-up, \.count-down \{ animation: none/);
});
