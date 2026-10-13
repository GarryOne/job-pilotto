// A launch names the browser's last-used profile, so it opens the page and not the "Who's using Chrome?" picker.
import test from 'node:test';
import assert from 'node:assert/strict';
import {browserCommand, LAUNCH} from '../lib/browser-launch.js';
import {lastUsedProfile} from '../lib/browser-profile.js';

const state = profile => () => JSON.stringify({profile: {last_used: profile}});
const norm = text => String(text).replace(/\\/g, '/');

test('every browser in LAUNCH gets its last-used profile on the Mac and on the PC', () => {
  for (const browser of LAUNCH) {
    const mac = browserCommand(['chrome://extensions'], 'darwin', {HOME: '/h'}, file => file === `/Applications/${browser.app}.app`, browser.app, state('Profile 2'));
    assert.deepEqual(mac[1], ['-a', browser.app, 'chrome://extensions', '--args', '--profile-directory=Profile 2'], browser.app);
    const exe = [...browser.win];
    const env = {LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local'};
    const pc = browserCommand(['chrome://extensions'], 'win32', env, file => norm(file).endsWith(exe.join('/')), browser.app, state('Profile 2'));
    assert.deepEqual(pc[1], ['--profile-directory=Profile 2', 'chrome://extensions'], browser.app);
  }
});

test('no known profile: the launch is what it was, and a bad Local State never throws or injects a flag', () => {
  const exists = () => true;
  const none = () => { throw new Error('ENOENT'); };
  assert.deepEqual(browserCommand(['u'], 'darwin', {HOME: '/h'}, exists, '', none)[1], ['-a', 'Google Chrome', 'u']);
  assert.equal(lastUsedProfile('Google Chrome', 'win32', {LOCALAPPDATA: 'C:\\L'}, () => 'not json'), '');
  assert.equal(lastUsedProfile('Google Chrome', 'win32', {LOCALAPPDATA: 'C:\\L'}, state('x --no-sandbox/../')), '');
  assert.equal(lastUsedProfile('Google Chrome', 'win32', {}, state('Default')), '');          // no env, no real profile read
  assert.equal(lastUsedProfile('Unknown', 'win32', {LOCALAPPDATA: 'C:\\L'}, state('Default')), '');
});
