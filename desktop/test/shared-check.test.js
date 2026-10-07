import test from 'node:test';
import assert from 'node:assert/strict';
import {sharedCheck} from '../lib/shared-check.js';

test('callers at the same time share one check and get the same answer', async () => {
  let runs = 0;
  const status = sharedCheck(async () => { runs++; await new Promise(r => setTimeout(r, 20)); return {connected: true}; });
  const [a, b] = await Promise.all([status(), status()]);
  assert.equal(runs, 1);
  assert.deepEqual(a, b);
});

test('the answer is reused for ttl, then checked again; a failed check is not kept', async () => {
  let t = 0, runs = 0, fail = true;
  const status = sharedCheck(async () => { runs++; if (fail) throw new Error('busy'); return {connected: true}; }, 1000, () => t);
  await assert.rejects(status());
  fail = false;
  await status(); await status();
  assert.equal(runs, 2);  // the failure wasn't kept; the success is reused
  t = 2000;
  await status();
  assert.equal(runs, 3);
});

// A sign-in or a sign-out changes the answer at once (Gmail disconnected, 7 Oct 2026): forget() drops the kept one.
test('forget makes the next ask check again', async () => {
  let runs = 0;
  const status = sharedCheck(async () => ({connected: ++runs === 1}), 30000, () => 0);
  assert.equal((await status()).connected, true);
  assert.equal((await status()).connected, true);   // kept
  status.forget();
  assert.equal((await status()).connected, false);
  assert.equal(runs, 2);
});
