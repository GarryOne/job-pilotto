// A tab the app opens for a job is that job's, even when the tab in front (another application's) counts as its opener
// (extension/tabs.js followOpener, background.js fill-mark handler). 9 Oct 2026 (mac-bc, e2e rerun-apply): the app's Lever tab for
// job B was created without its mark in url/pendingUrl; followOpener read the opener's keys, the fill mark handler set from:B in
// between, then followOpener wrote job A's session, job and from over it, and the extension filled B's form with A's kit.
import assert from 'node:assert/strict';
import {test} from 'node:test';

const store = {};
let gate = null, reached = null;   // held open while followOpener reads the opener's keys, so the mark handler can run in between
globalThis.chrome = {runtime: {getManifest: () => ({version: 'test'}), sendMessage: async () => {}}, storage: {local: {get: async () => ({}), set: async () => {}}, session: {
  async get(keys) {
    const list = [].concat(keys);
    if (gate && list.includes('armed:1')) { reached(); await gate; }
    return Object.fromEntries(list.filter(key => key in store).map(key => [key, store[key]]));
  },
  async set(items) { Object.assign(store, items); },
  async remove(keys) { for (const key of [].concat(keys)) delete store[key]; },
}}};
const {claimAppTab, followOpener} = await import('../../extension/tabs.js');

const A = 'https://e2e.recruitee.com/real/other-9b0bc5b0', B = 'https://jobs.lever.co/e2e/b/apply';

test('the app opens a tab for job B while job A\'s tab is in front: the tab stays B\'s, whatever order the two handlers run in', async () => {
  Object.assign(store, {'armed:1': true, 'session:1': 'session-A', 'from:1': A});
  let open; gate = new Promise(resolve => { open = resolve; });
  const atOpener = new Promise(resolve => { reached = resolve; });
  const following = followOpener({id: 2, openerTabId: 1, url: '', pendingUrl: ''});   // created before its address is known
  await atOpener;   // followOpener has passed its own checks and is reading the opener's keys
  // The fill mark handler (background.js) runs while followOpener waits on the opener's keys.
  claimAppTab(2);
  await globalThis.chrome.storage.session.remove(['job:2', 'session:2']);
  await globalThis.chrome.storage.session.set({'from:2': B});
  open(); gate = null;
  assert.equal(await following, false);
  assert.equal(store['from:2'], B);
  assert.equal(store['session:2'], undefined);
  assert.equal(store['job:2'], undefined);
});

test('a tab an application\'s own page opens (no mark): it still follows its opener', async () => {
  Object.assign(store, {'armed:3': true, 'session:3': 'session-C', 'from:3': A});
  assert.equal(await followOpener({id: 4, openerTabId: 3, url: '', pendingUrl: ''}), true);
  assert.equal(store['session:4'], 'session-C');
  assert.equal(store['from:4'], A);
});
