// The Gmail check after a sign-up (lib/account-check.js): runs once at a time per site, again when a pending account's sign-in page is met, and the session is told when only the person can finish it.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createAccountCheck} from '../lib/account-check.js';

const make = (outcome, extra = {}) => {
  const calls = {confirm: [], stuck: []};
  let clock = 1000;
  const check = createAccountCheck({confirm: async args => { calls.confirm.push(args); return typeof outcome === 'function' ? outcome() : outcome; },
    noteStuck: (...args) => calls.stuck.push(args), now: () => clock, gapMs: 60000, ...extra});
  return {calls, check, tick: ms => { clock += ms; }};
};

test('a code in the mail, or no mail: the session is told what the person must do; a confirmed account tells nothing', async () => {
  for (const [outcome, told] of [['code', true], ['none', true], ['confirmed', false]]) {
    const {calls, check} = make(outcome);
    assert.equal(await check({host: 'auth.jobs.ch', email: 'me@example.com', session: 'f8ddb7ed', wait: 20}), outcome);
    assert.equal(calls.stuck.length, told ? 1 : 0, outcome);
    if (told) assert.deepEqual(calls.stuck[0].slice(0, 3), ['f8ddb7ed', 'account', 'auth.jobs.ch']);
    if (told) assert.ok(calls.stuck[0][3].length > 0 && calls.stuck[0][3].length <= 80);
    assert.equal(calls.confirm[0].wait, 20);
  }
});

test('the same site is not checked twice at once or within the gap; a press (force) and a later look are', async () => {
  let release;
  let calls = 0;
  const slow = make(() => (calls++ ? 'code' : new Promise(resolve => { release = () => resolve('code'); })));   // only the first call is held
  const first = slow.check({host: 'h.example', email: 'a@b.c', session: 's1'});
  assert.equal(await slow.check({host: 'h.example', email: 'a@b.c', session: 's1'}), 'busy');
  release(); await first;
  assert.equal(await slow.check({host: 'h.example', email: 'a@b.c', session: 's1'}), 'recent');
  assert.equal(slow.calls.confirm.length, 1);
  slow.tick(61000);
  assert.equal(await slow.check({host: 'h.example', email: 'a@b.c', session: 's1'}), 'code');
  assert.equal(await slow.check({host: 'h.example', email: 'a@b.c', session: 's1', force: true}), 'code');
  assert.equal(await slow.check({host: 'other.example', email: 'a@b.c', session: 's1'}), 'code');
  assert.equal(slow.calls.confirm.length, 4);
});

test('a failing check leaves the site free to be tried again and says nothing to the session', async () => {
  const {calls, check} = make(() => { throw new Error('boom'); });
  assert.equal(await check({host: 'h.example', email: 'a@b.c', session: 's1', force: true}), 'error');
  assert.equal(calls.stuck.length, 0);
  assert.equal(await check({host: 'h.example', email: 'a@b.c', session: 's1', force: true}), 'error');
});
