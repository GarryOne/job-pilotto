// lib/leave-prompt.mjs goTo: when leaving opens Strategy's unsaved-edits prompt it presses Discard and waits for the page; otherwise it only clicks the nav.
import assert from 'node:assert/strict';
import test from 'node:test';
import {goTo} from '../lib/leave-prompt.mjs';

function fakePage({prompt}) {
  const done = [];
  const locator = selector => ({
    count: async () => (selector === '#strategy-leave-dialog[open]' && prompt ? 1 : 0),
    locator: inner => ({click: async () => done.push(`click ${selector} ${inner}`)}),
    waitFor: async () => done.push(`wait ${selector}`),
  });
  return {done, click: async selector => done.push(`click ${selector}`), locator};
}

test('a leave prompt is answered with Discard, then the page is waited for', async () => {
  const page = fakePage({prompt: true}), said = [];
  assert.equal(await goTo(page, 'jobs', line => said.push(line)), true);
  assert.deepEqual(page.done, ['click .nav[data-view="jobs"]', 'click #strategy-leave-dialog[open] button[value="discard"]', 'wait .view[data-view="jobs"]:not([hidden])']);
  assert.match(said[0], /discarded, on to jobs/);
});

test('without a prompt it only clicks the nav', async () => {
  const page = fakePage({prompt: false});
  assert.equal(await goTo(page, 'focus', () => assert.fail('nothing to say')), false);
  assert.deepEqual(page.done, ['click .nav[data-view="focus"]']);
});
