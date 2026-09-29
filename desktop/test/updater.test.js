// App updates (lib/updater.js): which release is newer, which download fits, the Mac swap.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {asset, check, macSwapScript, newer} from '../lib/updater.js';

test('versions compare as releases do: numbers, then a release beats its pre-releases', () => {
  assert.ok(newer('0.4.0-alpha.41', '0.4.0-alpha.39'));
  assert.ok(newer('0.4.0-alpha.10', '0.4.0-alpha.9'));
  assert.ok(newer('desktop-v0.4.0', '0.4.0-alpha.50'));
  assert.ok(newer('0.5.0-alpha.1', '0.4.9'));
  assert.ok(!newer('0.4.0-alpha.39', '0.4.0-alpha.39'));
  assert.ok(!newer('0.3.9', '0.4.0-alpha.1'));
});

const RELEASE = {tag_name: 'desktop-v0.4.0-alpha.41', name: '0.4 Alpha 41', body: 'Notes', html_url: 'https://github.com/x',
  assets: [{name: 'Job-Pilotto-0.4.0-alpha.41-arm64.dmg'}, {name: 'Job-Pilotto-0.4.0-alpha.41-arm64.zip', browser_download_url: 'https://dl/zip', size: 9},
    {name: 'Job-Pilotto-windows-x64.exe', browser_download_url: 'https://dl/exe'}]};

test('the download for this computer: the Mac .zip (not the .dmg), the Windows installer', () => {
  assert.equal(asset(RELEASE, 'darwin').name, 'Job-Pilotto-0.4.0-alpha.41-arm64.zip');
  assert.equal(asset(RELEASE, 'win32').name, 'Job-Pilotto-windows-x64.exe');
  assert.equal(asset(RELEASE, 'linux'), null);
});

test('an update is offered only when the latest stable release is newer', async () => {
  const fetcher = async () => ({ok: true, json: async () => RELEASE});
  assert.equal((await check('0.4.0-alpha.39', {fetcher, platform: 'darwin'})).download, 'https://dl/zip');
  assert.equal(await check('0.4.0-alpha.41', {fetcher, platform: 'darwin'}), null);
});

test('the Mac swap waits for the app to quit, replaces it, clears quarantine and reopens it', () => {
  const script = macSwapScript(123, "/Applications/Job Pilotto.app", '/tmp/x/Job Pilotto.app');
  assert.match(script, /kill -0 123/);
  assert.match(script, /mv '\/Applications\/Job Pilotto.app' '\/Applications\/Job Pilotto.app.old'/);
  assert.match(script, /open '\/Applications\/Job Pilotto.app'$/);
});
