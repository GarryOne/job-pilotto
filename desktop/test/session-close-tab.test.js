// Cancelling an application must not wait on a form tab that is already gone (lib/session-handlers.js closeSessionTab).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {closeSessionTab} from '../lib/session-handlers.js';

const old = {id: 's1', url: 'https://jobs.example/1', company: 'Acme'};

test('a tab known to be closed counts as closed at once: no 6 s wait, no browser fallback', async () => {
  const calls = [];
  const review = {tabOpen: () => false, delivered: async () => { calls.push('wait'); return false; }};
  assert.equal(await closeSessionTab({review, closeTab: async () => { calls.push('fallback'); return false; }}, old), true);
  assert.deepEqual(calls, []);
});

test('an open or unknown tab is asked to close, then closed from the browser if its page does not answer', async () => {
  for (const tabOpen of [true, null, undefined]) {
    const calls = [];
    const review = {tabOpen: () => tabOpen, delivered: async (id, ms) => { calls.push(['wait', id, ms]); return false; }};
    assert.equal(await closeSessionTab({review, closeTab: async target => { calls.push(['fallback', target.company]); return true; }}, old), true);
    assert.deepEqual(calls, [['wait', 's1', 6000], ['fallback', 'Acme']], String(tabOpen));
  }
  assert.equal(await closeSessionTab({review: {delivered: async () => true}, closeTab: async () => { throw new Error('not needed'); }}, old), true);   // a review without tabOpen
});
