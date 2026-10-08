import test from 'node:test';
import assert from 'node:assert/strict';
import {updateText} from '../renderer/update-text.js';

test('Updates line: available, up to date (with when it was checked), or not checked yet', () => {
  const now = Date.parse('2026-09-29T21:00:00Z');
  assert.deepEqual(updateText({offer: {version: '0.5.66'}}, now),
    {latest: false, text: 'Version 0.5.66 is available: use Update in the sidebar'});
  assert.deepEqual(updateText({offer: null, checkedAt: '2026-09-29T20:59:00Z'}, now), {latest: true, text: 'Up to date · checked just now'});
  assert.deepEqual(updateText({}, now), {latest: false, text: 'Not checked yet'});
});

test('from source: says git pull, never offers', () => {
  assert.deepEqual(updateText({fromSource: true, offer: {version: '9'}}), {latest: true, text: 'Running from source: update with git pull'});
});

test('Settings → Beta says what is on, and shows "Back to stable" only while the install is ahead of stable', async () => {
  const {betaText} = await import('../renderer/update-text.js');
  assert.deepEqual(betaText({on: false, current: '0.5.252', stable: '0.5.252', ahead: false}), {text: 'Off · you get stable versions only', toggle: 'Get the beta version', back: false});
  assert.equal(betaText({on: true, current: '0.5.252', stable: '0.5.252', ahead: false}).toggle, 'Turn off');
  const ahead = betaText({on: true, current: '0.5.255', stable: '0.5.252', ahead: true});
  assert.equal(ahead.back, true);
  assert.match(ahead.text, /^On · ahead of stable 0\.5\.252$/);
  assert.equal(betaText({on: false, current: '0.5.255', stable: '0.5.252', ahead: true}).back, true, 'turning the beta off does not roll anyone back by itself');
  assert.equal(betaText({fromSource: true}).toggle, '');
});

test('Settings → Diagnostics → Test builds says what it is and offers the switch', async () => {
  const {testText} = await import('../renderer/update-text.js');
  assert.match(testText({test: false}).text, /can be broken/);
  assert.equal(testText({test: false}).toggle, 'Get test builds');
  assert.equal(testText({test: true}).toggle, 'Turn off');
  assert.equal(testText({fromSource: true}).toggle, '');
});
