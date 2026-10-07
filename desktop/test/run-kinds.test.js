// Every task the app runs gets a row in Notion Search runs (owner's rule): its kind must have a Mode (lib/run-history.js KIND), or the
// backfill skips it and its log lives only in app.log (7 Oct 2026: Find jobs using your browser had no row, its logs were lost).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {RUN_KINDS} from '../lib/run-history.js';

test('every task kind the app runs has a Notion mode', () => {
  const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  const kinds = new Set([...main.matchAll(/pipeline\.(?:work|task)\(storage, '([a-z]+)'/g)].map(match => match[1]));
  assert.ok(kinds.has('visits') && kinds.has('tailor'), `found: ${[...kinds]}`);
  const kinded = new Set(Object.values(RUN_KINDS));
  assert.deepEqual([...kinds].filter(kind => !kinded.has(kind)), []);
});
