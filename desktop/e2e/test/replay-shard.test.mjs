// Guards lib/replay-shard.mjs: the CI matrix splits the recorded cases across jobs; every case runs in exactly one shard, whatever the shard count.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {loadCases} from '../lib/page-replay.mjs';
import {parseShard, shardOf} from '../lib/replay-shard.mjs';

test('every recorded case lands in exactly one shard, for any shard count', () => {
  const cases = loadCases();
  assert.ok(cases.length > 20, 'the recorded cases are found');
  for (let count = 1; count <= 9; count += 1) {
    const names = [];
    for (let index = 1; index <= count; index += 1) names.push(...shardOf(cases, index, count).map(one => one.name));
    assert.deepEqual(names.sort(), cases.map(one => one.name).sort(), `${count} shards: no case dropped or run twice`);
  }
});

test('the shards are balanced by what a case costs, not by count', () => {
  const cases = Array.from({length: 8}, (_, n) => ({name: `c${n}`, expect: {seconds: n < 2 ? 60 : 10, notTold: ['x']}, pages: []}));
  const [a, b] = [shardOf(cases, 1, 2), shardOf(cases, 2, 2)];
  assert.notEqual(a.filter(one => one.expect.seconds === 60).length, 2, 'the two long cases are not in one shard');
  assert.notEqual(b.filter(one => one.expect.seconds === 60).length, 2);
});

test('a shard spec is "i/n" with 1 <= i <= n, and anything else is refused', () => {
  assert.deepEqual(parseShard('2/4'), {index: 2, count: 4});
  assert.equal(parseShard(''), null, 'no spec: the whole set');
  for (const bad of ['0/4', '5/4', '1/0', 'a/b', '3']) assert.throws(() => parseShard(bad), /shard/, bad);
});
