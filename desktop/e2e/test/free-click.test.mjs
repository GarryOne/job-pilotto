// Guards the person's click on a sign-up page: it waits for the fill overlay and tries again when the overlay came back.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ticked, pressed, whenFree} from '../lib/free-click.mjs';

const fakeTab = failures => {
  const calls = {waits: 0, checks: 0, clicks: 0};
  return {calls, waitForFunction: async () => { calls.waits += 1; },
    check: async () => { calls.checks += 1; if (calls.checks <= failures) throw new Error('Clicking the checkbox did not change its state'); },
    click: async () => { calls.clicks += 1; }};
};

test('a tick lost under a returning overlay is made again after it lifts', async () => {
  const tab = fakeTab(2);
  await ticked(tab, '#robot');
  assert.equal(tab.calls.checks, 3);
  assert.equal(tab.calls.waits, 3);   // the overlay is waited for before every attempt
});

test('a click waits for the overlay once when nothing goes wrong', async () => {
  const tab = fakeTab(0);
  await pressed(tab, '#create_account');
  assert.deepEqual(tab.calls, {waits: 1, checks: 0, clicks: 1});
});

test('a click that never lands still fails, with the page error', async () => {
  const tab = fakeTab(99);
  await assert.rejects(() => whenFree(tab, options => tab.check('#robot', options), {tries: 3}), /did not change its state/);
  assert.equal(tab.calls.checks, 3);
});
