// Kept AI decisions expire and can be dropped (lib/kept-decisions.js): its invariants.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {MAX_AGE_MS, forget, keep, keptValue, readKept} from '../lib/kept-decisions.js';

const memory = () => { const files = {}; return {files, readText: name => files[name] ?? null, writeText: (name, text) => { files[name] = text; }}; };

test('a kept answer is found while young, not once older than the limit', () => {
  const storage = memory(), kept = readKept(storage, 'f.json');
  keep(storage, 'f.json', kept, 'k', 'Close', 1000);
  assert.deepEqual(keptValue(readKept(storage, 'f.json'), 'k', {now: 2000}), {found: true, value: 'Close'});
  assert.equal(keptValue(readKept(storage, 'f.json'), 'k', {now: 1000 + MAX_AGE_MS + 1}).found, false);
});

test('1: an answer kept before answers had a time counts as expired', () => {
  assert.equal(keptValue({k: 'Cookie notice'}, 'k').found, false);
});

test('2: forget removes exactly that key, and says whether there was one', () => {
  const storage = memory(), kept = readKept(storage, 'f.json');
  keep(storage, 'f.json', kept, 'a', 'x'); keep(storage, 'f.json', kept, 'b', 'y');
  assert.equal(forget(storage, 'f.json', 'a'), true);
  assert.equal(forget(storage, 'f.json', 'a'), false);
  assert.deepEqual(Object.keys(readKept(storage, 'f.json')), ['b']);
});
