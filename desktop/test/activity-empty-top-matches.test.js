// A digest card with no items says so in words and offers "Open Jobs", not an empty "Top matches" with a bare link.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

test('digest card explains an empty Top matches', () => {
  const source = fs.readFileSync(path.join(here, '../renderer/pages/activity.js'), 'utf8');
  assert.match(source, /nothing new to show/);
  assert.match(source, /Open Jobs →/);
});

// #309: a count the message does not carry (an older or cut message, "applied" when none) was drawn as "–": three dashes beside "4 new this run".
test('a run card leaves out a count it does not have, never shows "–"', () => {
  const source = fs.readFileSync(path.join(here, '../renderer/pages/activity.js'), 'utf8');
  const start = source.indexOf('function renderRunCard');
  const body = source.slice(start, source.indexOf('\nfunction ', start + 1));
  assert.match(body, /const stat = \(value, label\) => \{ if \(value == null\) return '';/);
  assert.doesNotMatch(body, /value \?\? '–'/);
  assert.match(body, /stats\.childElementCount \? \[stats\] : \[\]/);
});
