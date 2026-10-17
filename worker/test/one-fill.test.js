// A tab is never filled twice at once: a second ask while a fill runs (Windows timing: two reads 0.2 s apart) joins the running fill. Every caller of fillOpenedTab goes through it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {oneFillPerTab} from '../../extension/one-fill.js';

test('a second ask 0.2 s after the first joins it: one fill, one result', async () => {
  let starts = 0, joins = 0;
  const slow = () => new Promise(resolve => { starts++; setTimeout(() => resolve({filled: 4}), 60); });
  const first = oneFillPerTab(7, slow, {onJoin: () => joins++});
  await new Promise(resolve => setTimeout(resolve, 20));
  const second = oneFillPerTab(7, slow, {onJoin: () => joins++});
  assert.deepEqual(await Promise.all([first, second]), [{filled: 4}, {filled: 4}]);
  assert.equal(starts, 1); assert.equal(joins, 1);
  await oneFillPerTab(7, slow); assert.equal(starts, 2, 'after it ended, the next ask fills again');
});

test('another tab and a failed fill do not block', async () => {
  const boom = oneFillPerTab(1, async () => { throw new Error('x'); });
  await assert.rejects(boom);
  assert.equal(await oneFillPerTab(1, async () => 'again'), 'again');
  const [a, b] = await Promise.all([oneFillPerTab(2, async () => 'a'), oneFillPerTab(3, async () => 'b')]);
  assert.deepEqual([a, b], ['a', 'b']);
});

test('the class: background.js starts every fill through oneFillPerTab', () => {
  const source = fs.readFileSync(new URL('../../extension/background.js', import.meta.url), 'utf8');
  assert.equal([...source.matchAll(/fillOpenedTabNow\(/g)].length, 2, 'defined once, called once (inside oneFillPerTab)');
  assert.match(source, /oneFillPerTab\(tab\.id, async \(\) => \{\s*fillsNow\.add\(tab\.id\);\s*try \{ return await fillOpenedTabNow/);
});
