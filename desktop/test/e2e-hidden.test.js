// An e2e run keeps the app's windows hidden and out of focus; a user never gets that.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {hiddenRun, hideWindows} from '../lib/e2e-hidden.js';
import {browserCommand} from '../lib/browser-launch.js';

const fakes = () => {
  class BrowserWindow { show() { return 'shown'; } focus() { return 'focused'; } moveTop() { return 'top'; } }
  const app = {policy: 'regular', focus: () => 'stolen', setActivationPolicy(policy) { this.policy = policy; }};
  const shell = {openPath: async () => 'opened', openExternal: async () => 'opened', showItemInFolder: () => 'opened'};
  return {app, BrowserWindow, shell};
};

test('hidden only in an e2e run that asks for it', () => {
  assert.equal(hiddenRun({}), false);
  assert.equal(hiddenRun({JOB_PILOTTO_E2E_HIDDEN: '1'}), false, 'a user never gets it');
  assert.equal(hiddenRun({JOB_PILOTTO_E2E: '1', JOB_PILOTTO_E2E_HIDDEN: '0'}), false);
  assert.equal(hiddenRun({JOB_PILOTTO_E2E: '1', JOB_PILOTTO_E2E_HIDDEN: '1'}), true);
});

test('a hidden run never shows, focuses or opens anything', async () => {
  const {app, BrowserWindow, shell} = fakes();
  assert.equal(hideWindows({app, BrowserWindow, shell, env: {JOB_PILOTTO_E2E: '1', JOB_PILOTTO_E2E_HIDDEN: '1'}, platform: 'darwin'}), true);
  const window = new BrowserWindow();
  assert.equal(window.show(), undefined);
  assert.equal(window.focus(), undefined);
  assert.equal(app.focus(), undefined);
  assert.equal(app.policy, 'accessory');
  assert.equal(await shell.openPath('/tmp/cv.pdf'), '');
  await shell.openExternal('https://example.com');
  assert.deepEqual(globalThis.__e2eShell.map(call => call.name), ['openPath', 'openExternal']);
});

test('otherwise the app is left alone', () => {
  const {app, BrowserWindow, shell} = fakes();
  assert.equal(hideWindows({app, BrowserWindow, shell, env: {JOB_PILOTTO_E2E: '1'}, platform: 'darwin'}), false);
  assert.equal(new BrowserWindow().show(), 'shown');
  assert.equal(app.policy, 'regular');
});

test('a hidden run opens browser tabs in the background', () => {
  const exists = () => true;
  assert.deepEqual(browserCommand(['https://x'], 'darwin', {HOME: '/h'}, exists)[1], ['-a', 'Google Chrome', 'https://x']);
  assert.deepEqual(browserCommand(['https://x'], 'darwin', {HOME: '/h', JOB_PILOTTO_E2E: '1', JOB_PILOTTO_E2E_HIDDEN: '1'}, exists)[1], ['-g', '-a', 'Google Chrome', 'https://x']);
});
