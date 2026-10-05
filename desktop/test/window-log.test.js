// The main window and an update leave a trace in logs/app.log: a blank window after an update (3 Oct 2026) had none.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {macSwapScript} from '../lib/updater.js';
import {versionLine, watchWindow} from '../lib/window-log.js';

function fakeWindow({shown = 1} = {}) {
  const handlers = {}, timers = [], lines = [];
  const contents = {on: (name, fn) => { handlers[name] = fn; }, isDestroyed: () => false, executeJavaScript: async () => shown};
  let clock = 0;
  watchWindow(contents, {log: (area, message, data) => lines.push(`[${area}] ${message}${data ? ` ${JSON.stringify(data)}` : ''}`),
    now: () => clock, setTimer: fn => timers.push(fn)});
  return {emit: (name, ...args) => handlers[name](...args), tick: ms => { clock += ms; }, runTimers: async () => { for (const fn of timers.splice(0)) await fn(); }, lines};
}

test('a window that loads and shows a page logs its load time and nothing else', async () => {
  const win = fakeWindow();
  win.tick(1234); win.emit('did-finish-load');
  await win.runTimers();
  assert.deepEqual(win.lines, ['[window] main: loaded in 1.2 s']);
});

test('a window still blank after loading says so, with the page errors before it', async () => {
  const win = fakeWindow({shown: 0});
  win.emit('console-message', {level: 'error', message: 'Uncaught SyntaxError: x is not exported', lineNumber: 3, sourceId: 'file:///app.asar/renderer/app.js'});
  win.emit('console-message', {level: 'info', message: 'fine'});
  win.emit('did-finish-load');
  await win.runTimers();
  assert.match(win.lines[0], /page error .*x is not exported.*"at":"app\.js:3"/);
  assert.equal(win.lines.filter(line => /fine/.test(line)).length, 0, 'only errors are logged');
  assert.ok(win.lines.some(line => /still blank 15 s after loading/.test(line)));
});

test('a load that fails, a crashed or frozen renderer, a broken preload, and no load at all are each logged', async () => {
  const win = fakeWindow();
  win.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'file:///x/renderer/index.html', true);
  win.emit('render-process-gone', {}, {reason: 'crashed', exitCode: 11});
  win.emit('unresponsive'); win.emit('responsive');
  win.emit('preload-error', {}, '/x/preload.cjs', new Error('boom'));
  await win.runTimers();
  const text = win.lines.join('\n');
  for (const want of [/load failed .*ERR_FILE_NOT_FOUND.*renderer\/index\.html/, /renderer gone .*crashed.*freeMb.*ppid/, /not responding/, /responding again/, /preload failed .*preload\.cjs.*boom/, /not loaded after 30 s/]) assert.match(text, want);
});

test('the first start of a new version says which version it came from, once', () => {
  let settings = {lastStartedVersion: '0.4.9'};
  const storage = {settings: () => settings, saveSettings: patch => { settings = {...settings, ...patch}; }};
  assert.equal(versionLine(storage, '0.5.0', 'build 12 · abc1234'), 'first start of 0.5.0 (build 12 · abc1234), updated from 0.4.9');
  assert.equal(versionLine(storage, '0.5.0'), null);
});

test('the Mac swap writes each step into the app log and puts the new app in place', { skip: process.platform === 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swap-'));
  const oldApp = path.join(dir, "Job Pilotto.app"), newApp = path.join(dir, 'new', 'Job Pilotto.app'), logFile = path.join(dir, 'app.log');
  fs.mkdirSync(oldApp); fs.writeFileSync(path.join(oldApp, 'v'), 'old');
  fs.mkdirSync(newApp, {recursive: true}); fs.writeFileSync(path.join(newApp, 'v'), 'new');
  const script = macSwapScript(999999, oldApp, newApp, logFile).replace(/\nopen .*$/, '');   // no real `open` in a test
  execFileSync('/bin/sh', ['-c', script]);
  assert.equal(fs.readFileSync(path.join(oldApp, 'v'), 'utf8'), 'new');
  const log = fs.readFileSync(logFile, 'utf8');
  assert.match(log, /\[update\] swap: waiting for the app \(pid 999999\) to quit\n.*\[update\] swap: the app quit; putting the new version in place/);
  assert.doesNotMatch(log, /FAILED/);
});
