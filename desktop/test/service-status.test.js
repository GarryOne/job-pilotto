// The Chrome extension's state (renderer/service-status.js): what the card, its pill and the "finish connecting"
// alert all read. Two facts decide it — what the browsers recorded, and when it last reported — and the only state
// that waits is the moment before the browser's profile has been read (1 Oct 2026: it used to wait a minute and then
// call an installed extension "not connected").
import assert from 'node:assert/strict';
import test from 'node:test';
import {FRESH_MS, extensionState} from '../renderer/service-status.js';

const copy = {version: '0.8.16', enabled: true, folder: '/app/extension', current: true};
const at = now => ({at: now, version: '0.8.16'});

test('before the profile is read it is Checking…, and that is the only state that waits', () => {
  assert.deepEqual(extensionState({known: false}), {state: 'checking', checking: true, on: false, version: '', words: 'Checking…'});
  for (const args of [{}, {installed: [copy]}, {installed: [copy], browserRunning: true}, {installed: [copy], browserRunning: false}]) {
    assert.equal(extensionState(args).checking, false, JSON.stringify(args));
  }
});

test('a fresh report is connected; an older one is not, however installed the browser says it is', () => {
  const now = 10_000_000;
  assert.equal(extensionState({installed: [copy], seen: at(now - 1000), now}).state, 'connected');
  assert.equal(extensionState({installed: [copy], seen: at(now - 1000), now}).on, true);
  assert.equal(extensionState({installed: [copy], seen: at(now - FRESH_MS - 1), now}).state, 'idle');
  assert.equal(extensionState({installed: [copy], seen: at(now - FRESH_MS - 1), now}).on, false);
});

test('the report\'s version wins over the copy on disk (that is what Chrome is running)', () => {
  const now = 1;
  assert.equal(extensionState({installed: [{...copy, version: '0.8.0'}], seen: at(now), now}).version, '0.8.16');
  assert.equal(extensionState({installed: [copy], seen: {at: now, version: '0.9.0'}, now}).version, '0.9.0');
});

test('installed but quiet: open Chrome, not connected, or turned off — never "Checking…"', () => {
  assert.deepEqual(extensionState({installed: [copy], browserRunning: false}),
    {state: 'closed', checking: false, on: false, version: '0.8.16', words: 'Installed · open Chrome'});
  assert.equal(extensionState({installed: [copy], browserRunning: true}).state, 'idle');
  assert.equal(extensionState({installed: [copy], browserRunning: true}).words, 'Installed · not connected');
  assert.equal(extensionState({installed: [{...copy, enabled: false}], browserRunning: true}).words, 'Installed · turned off');
  // Knowing nothing about the browser (the answer kept from before) still says installed, not Checking….
  assert.equal(extensionState({installed: [copy] , browserRunning: null}).state, 'idle');
});

test('nothing installed reads as Not connected at once', () => {
  assert.deepEqual(extensionState({installed: [], seen: null}),
    {state: 'absent', checking: false, on: false, version: '', words: 'Not connected'});
});
