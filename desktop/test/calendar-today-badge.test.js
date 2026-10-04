// The calendar's "today" number must use a defined colour token (it once used an undefined --accent: white on nothing).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = name => fs.readFileSync(new URL(`../renderer/${name}`, import.meta.url), 'utf8');

test('every var(--x) on .cal-cell.today is defined in tokens.css', () => {
  const rule = read('style.css').split('\n').find(l => l.startsWith('.cal-cell.today'));
  const tokens = read('tokens.css');
  assert.ok(rule);
  for (const [, name] of rule.matchAll(/var\((--[\w-]+)\)/g)) assert.ok(tokens.includes(`${name}:`), `${name} is not defined`);
});
