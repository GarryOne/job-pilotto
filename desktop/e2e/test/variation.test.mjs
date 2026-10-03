import assert from 'node:assert/strict';
import {test} from 'node:test';
import {WINDOW_SIZES, createVariation} from '../lib/variation.mjs';

const LIST = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

test('no seed (or 0) is the fixed path: nothing moves, the default window', () => {
  for (const env of [{}, {E2E_SEED: ''}, {E2E_SEED: '0'}, {E2E_SEED: 'junk'}]) {
    const v = createVariation(env);
    assert.equal(v.fixed, true);
    assert.deepEqual(v.shuffle(LIST), LIST);
    assert.deepEqual(v.pick(WINDOW_SIZES), [1280, 820]);
  }
});

test('the same seed replays the same path; another seed walks another', () => {
  const a = createVariation({E2E_SEED: '12345'}), b = createVariation({E2E_SEED: '12345'}), c = createVariation({E2E_SEED: '99'});
  assert.deepEqual(a.shuffle(LIST), b.shuffle(LIST));
  assert.deepEqual(a.pick(WINDOW_SIZES), b.pick(WINDOW_SIZES));
  assert.notDeepEqual(a.shuffle(LIST), c.shuffle(LIST));
  assert.equal(a.fixed, false);
});

test('a shuffle keeps every item exactly once and never edits its input', () => {
  const v = createVariation({E2E_SEED: '7'}), input = [...LIST];
  const out = v.shuffle(input);
  assert.deepEqual(input, LIST);
  assert.deepEqual([...out].sort(), LIST);
});

test('over many seeds the page order and the window size really vary', () => {
  const orders = new Set(), sizes = new Set();
  for (let seed = 1; seed <= 40; seed++) { const v = createVariation({E2E_SEED: String(seed)}); orders.add(v.shuffle(LIST).join('')); sizes.add(v.pick(WINDOW_SIZES).join('x')); }
  assert.ok(orders.size > 30, `${orders.size} different orders in 40 seeds`);
  assert.equal(sizes.size, WINDOW_SIZES.length);
});
