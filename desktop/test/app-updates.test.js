// The app's update round trip (lib/app-updates.js): an update this install started is read back at the next check, logged, and
// one that didn't take (the same version still running) sends the person to the download page instead of the same failing round.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppUpdates} from '../lib/app-updates.js';

const LATEST = {tag_name: 'desktop-v0.6.15', name: '0.6.15', body: '', html_url: 'https://github.com/x/0.6.15',
  assets: [{name: 'Job-Pilotto-0.6.15-x64.exe', browser_download_url: 'https://dl/0.6.15.exe'}, {name: 'Job-Pilotto-0.6.15-arm64.zip', browser_download_url: 'https://dl/0.6.15.zip'}]};

// The updater offers only Mac and Windows downloads: CI's Linux would get no offer at all (9 Oct 2026, red build d7b907a).
const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
test.before(() => Object.defineProperty(process, 'platform', {...realPlatform, value: 'win32'}));
test.after(() => Object.defineProperty(process, 'platform', realPlatform));

function appUpdates(version, settings) {
  const opened = [];
  const updates = createAppUpdates({Menu: {}, dialog: {}, track: () => {}, toWindow: () => {}, getWindow: () => null, getTelemetry: () => null,
    app: {isPackaged: true, getVersion: () => version, getPath: () => '/x', quit: () => {}},
    getStorage: () => ({settings: () => settings, saveSettings: patch => Object.assign(settings, patch)}),
    openExternal: url => opened.push(url)});
  return {updates, opened};
}

test('an update that did not take sends the person to the download page, not round the same loop', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ok: true, json: async () => LATEST}));
  const settings = {updateTried: {to: '0.6.15', from: '0.6.11'}};
  const {updates} = appUpdates('0.6.11', settings);
  const {offer} = await updates.checkForUpdate(true);
  assert.equal(offer.failedBefore, true);
  const result = await updates.installUpdate();
  assert.equal(result.ok, false);
  assert.equal(result.manual, true);
  assert.equal(result.url, 'https://github.com/x/0.6.15');
  assert.match(result.text, /didn't work last time/);
});

test('an update that took is forgotten, and the first try of a new one is automatic', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ok: true, json: async () => LATEST}));
  const settings = {updateTried: {to: '0.6.14', from: '0.6.11'}};
  const {updates} = appUpdates('0.6.14', settings);
  const {offer} = await updates.checkForUpdate(true);
  assert.equal(settings.updateTried, null, 'installed: nothing left to check');
  assert.ok(!offer.failedBefore);
});

test('a different, newer version than the one that failed is tried automatically again', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ok: true, json: async () => LATEST}));
  const {updates} = appUpdates('0.6.11', {updateTried: {to: '0.6.13', from: '0.6.11'}});
  const {offer} = await updates.checkForUpdate(true);
  assert.ok(!offer.failedBefore);
});

// #333: an install that failed before the app quit (offline, 5xx) is not an update that "did not take effect": the next start must offer it again.
test('an install that fails to download is not remembered as tried', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => (++calls === 1 ? {ok: true, json: async () => LATEST} : {ok: false, status: 500, statusText: 'Server Error'}));
  const settings = {};
  const {updates} = appUpdates('0.6.11', settings);
  await updates.checkForUpdate(true);
  const result = await updates.installUpdate();
  assert.equal(result.ok, false);
  assert.ok(calls > 1, 'the download was tried (the setup took effect)');
  assert.equal(settings.updateTried, null, 'nothing left to read back');
});
