// Profile tabs show what they read last time at once, refresh behind it, and draw the skeleton card only when nothing is kept (renderer/swr.js).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {forgetKept, swr} from '../renderer/swr.js';

test('a second open paints the kept answer before the read returns, then the fresh one', async () => {
  forgetKept();
  const painted = [];
  let release;
  const slow = new Promise(resolve => { release = resolve; });
  const calls = {loading: 0, read: 0};
  const opts = {loading: () => calls.loading++, paint: (answer, kept) => painted.push([answer.v, kept])};
  await swr('tab', async () => ({ok: true, v: 1}), opts);
  const second = swr('tab', async () => { calls.read++; await slow; return {ok: true, v: 2}; }, opts);
  assert.deepEqual(painted, [[1, false], [1, true]], 'kept copy painted at once, read still pending');
  release();
  await second;
  assert.deepEqual(painted.at(-1), [2, false]);
  assert.equal(calls.loading, 1, 'the skeleton card only the first time');
});

test('a failed refresh leaves the kept copy; a failed first read says so', async () => {
  forgetKept();
  const fails = [];
  const opts = {paint() {}, fail: answer => fails.push(answer.error)};
  await swr('a', async () => ({ok: false, error: 'offline'}), opts);
  assert.deepEqual(fails, ['offline']);
  await swr('b', async () => ({ok: true}), opts);
  await swr('b', async () => { throw new Error('boom'); }, opts);
  assert.deepEqual(fails, ['offline'], 'kept copy stays, no error card over it');
});

test('every Profile tab loader reads through swr (a new one must too)', () => {
  for (const file of ['outline-tab.js', 'experience-profile.js', 'details-facts.js', 'experience.js']) {
    assert.match(readFileSync(new URL(`../renderer/pages/${file}`, import.meta.url), 'utf8'), /\bswr\(/, `${file} shows kept data first`);
  }
});
