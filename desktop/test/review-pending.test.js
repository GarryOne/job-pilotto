import test from 'node:test';
import assert from 'node:assert/strict';
import {add, remove, settle} from '../renderer/review-pending.js';

const memory = () => { const m = new Map(); return {getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v)}; };

test('a review sent to GitHub stays pending until Notion shows its outcome, or 20 minutes pass', () => {
  const s = memory();
  add('p1', 1000, s); add('p2', 1000, s);
  assert.deepEqual([...settle([{id: 'p1'}, {id: 'p2'}], 2000, s)], ['p1', 'p2']);
  assert.deepEqual([...settle([{id: 'p1', overall: 'positive'}, {id: 'p2'}], 3000, s)], ['p2']);
  assert.deepEqual([...settle([{id: 'p2'}], 1000 + 21 * 60 * 1000, s)], []);
  add('p3', 1000, s); remove('p3', s);
  assert.deepEqual([...settle([], 2000, s)], []);
});
