// App updates (lib/updater.js): which release is newer, which download fits, the Mac swap, the Windows install.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {asset, check, install, macSwapScript, newer, windowsUpdateScript} from '../lib/updater.js';

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

test('the Windows update waits for the app to quit, installs quietly and reopens it', () => {
  const exe = "C:\\Users\\O'Brien\\AppData\\Local\\Programs\\Job Pilotto\\Job Pilotto.exe";
  const script = windowsUpdateScript(4242, 'C:\\Temp\\Job-Pilotto-Setup.exe', exe);
  assert.match(script, /Wait-Process -Id 4242 -ErrorAction SilentlyContinue/);
  assert.match(script, /Start-Process -FilePath 'C:\\Temp\\Job-Pilotto-Setup\.exe' -ArgumentList '\/S' -Wait/);
  // A quiet install: no wizard to click through, which is what makes it the same one-click update the Mac gets.
  assert.match(script, /-ArgumentList '\/S' -Wait/);
  assert.ok(script.includes("Start-Process -FilePath 'C:\\Users\\O''Brien\\AppData\\Local\\Programs\\Job Pilotto\\Job Pilotto.exe'"),
    "the app is opened again after the install, with the path's apostrophe doubled for PowerShell");
});

test('installing on Windows downloads the installer, runs PowerShell on the script, and only then quits', async () => {
  const calls = [];
  const steps = [];
  await install({download: 'https://dl/exe'}, {
    platform: 'win32', pid: 4242, exe: 'C:\\Programs\\Job Pilotto\\Job Pilotto.exe',
    fetcher: async () => ({ok: true, arrayBuffer: async () => new ArrayBuffer(4)}),
    spawn: (file, args, options) => { calls.push({file, args, options}); return {unref: () => calls.push('unref')}; },
    quit: () => calls.push('quit'),
    onStep: text => steps.push(text),
  });
  const run = calls.find(call => call.file === 'powershell.exe');
  assert.ok(run, 'PowerShell runs the update script');
  assert.deepEqual(run.args.slice(0, 4), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File']);
  assert.equal(run.options.detached, true, 'it outlives the app it is about to close');
  assert.equal(calls.at(-1), 'quit', 'the app quits only after the script is running');
  assert.ok(calls.indexOf('unref') < calls.indexOf('quit'));
  // What it will do, read back from the script the app wrote for it.
  const written = fs.readFileSync(run.args[4], 'utf8');
  assert.match(written, /Wait-Process -Id 4242/);
  assert.match(written, /-ArgumentList '\/S' -Wait/);
  assert.match(written, /Start-Process -FilePath 'C:\\Programs\\Job Pilotto\\Job Pilotto\.exe'/);
  assert.deepEqual(steps, ['Downloading…', 'Installing and restarting…']);
});
