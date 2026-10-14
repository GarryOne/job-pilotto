// The Mac-vs-Linux replay table (replay-os-compare.mjs): which rows are the same as live on each runner. Pure: no browser.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {compare, markdown} from '../replay-os-compare.mjs';

const rec = (name, hit, extra = 0, filled = 8) => ({name, live: {asks: 4}, network: {hit, extra, notRecorded: 0}, outcome: {reached: 'form', filled, left: 2}});

test('per row: same as live on each runner, and where Linux misses a row the Mac gets', () => {
  const result = compare([rec('a', 4), rec('b', 4), rec('c', 3, 1), rec('d', 4)], [rec('a', 4), rec('b', 2, 1), rec('c', 3, 1)]);
  assert.deepEqual([result.total, result.macSame, result.linuxSame, result.both, result.ran], [4, 3, 1, 1, 3]);
  const text = markdown(result), table = text.split('\n').filter(line => /^\| [a-d] \|/.test(line));
  assert.match(text, /same as live on Mac 3, on Linux 1, on both 1 of 4 rows/);
  assert.match(table[0], /^\| b \|.*❌ Linux misses \|$/, 'a miss on Linux only comes first');
  assert.match(table.find(line => line.startsWith('| a ')), /✅ same on both/);
  assert.match(table.find(line => line.startsWith('| c ')), /both not same/);
  assert.match(table.find(line => line.startsWith('| d ')), /not run/);
});

test('no Linux result says so and never throws', () => {
  assert.match(markdown(compare([rec('a', 4)], [])), /No Linux result this run/);
});
