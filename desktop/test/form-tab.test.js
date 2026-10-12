// Driving Chrome for a session's tab (lib/form-tab.js). Which tab is the session's is lib/session-tab.js (test/session-tab.test.js); here: what happens around it.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {closeFormTab, listTabs, openFormTab, reloadFormTab} from '../lib/form-tab.js';

test('off a Mac, Chrome cannot be scripted: no tabs, nothing closed, and the reload is the user\'s to do', async () => {
  assert.deepEqual(await listTabs('win32'), []);
  assert.equal(await closeFormTab({id: 's1', boundTab: 5}, 'win32'), false);
  assert.equal(await reloadFormTab({id: 's1', boundTab: 5}, 'win32'), 'manual');
});

test('without a way to drive Chrome, Open filled form says "none" and opens nothing', async () => {
  if (process.platform === 'darwin') return;   // on a Mac this would drive the owner's Chrome: the tests never do (safety rule)
  assert.equal(await openFormTab({id: 's1', boundTab: 5}), 'none');
});
