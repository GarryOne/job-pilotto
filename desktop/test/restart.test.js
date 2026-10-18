// One restart path (lib/restart.js): every relaunch ends with exactly one running copy (owner, 18 Oct 2026: two app copies after "Restart to get fixes").
// Electron starts one new copy per app.relaunch() call when the app exits, so a second click or a cancelled quit used to leave two copies or a ghost relaunch.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {EventEmitter} from 'node:events';
import {test} from 'node:test';
import {createRestarter} from '../lib/restart.js';

const make = () => {
  const app = new EventEmitter(), calls = [], logs = [];
  app.relaunch = options => calls.push(['relaunch', options]);
  app.quit = () => { calls.push(['quit']); };
  app.exit = code => calls.push(['exit', code]);
  return {app, calls, logs, restarter: createRestarter({app, log: message => logs.push(message)})};
};
const relaunches = calls => calls.filter(call => call[0] === 'relaunch');

test('a quit restart relaunches only when the quit goes through (will-quit), never at the click', () => {
  const {app, calls, restarter} = make();
  restarter.restart('fixes');
  assert.deepEqual(calls, [['quit']], 'nothing is relaunched while the quit guard may still stop the quit');
  app.emit('will-quit');
  assert.equal(relaunches(calls).length, 1);
});

test('a second click (or the permission toast) while the first restart is under way starts no second copy', () => {
  const {app, calls, restarter} = make();
  restarter.restart('fixes'); restarter.restart('fixes'); restarter.restart('toast', {args: ['--x']}, {how: 'exit'});
  app.emit('will-quit'); app.emit('will-quit');
  assert.equal(relaunches(calls).length, 1);
  assert.equal(calls.filter(call => call[0] === 'quit').length, 1);
  assert.equal(calls.filter(call => call[0] === 'exit').length, 0);
});

test('a cancelled quit leaves no relaunch pending: the next normal quit starts nothing, and a new restart works', () => {
  const {app, calls, restarter} = make();
  restarter.restart('fixes');
  restarter.cancel();
  app.emit('will-quit');
  assert.equal(relaunches(calls).length, 0);
  restarter.restart('fixes again');
  app.emit('will-quit');
  assert.equal(relaunches(calls).length, 1);
});

test('an exit restart (reset, import, demo) relaunches with its options and exits at once, once', () => {
  const {calls, restarter} = make();
  restarter.restart('import', {args: ['--a']}, {how: 'exit'}); restarter.restart('import', {args: ['--a']}, {how: 'exit'});
  assert.deepEqual(calls, [['relaunch', {args: ['--a']}], ['exit', 0]]);
});

test('every restart says why in the log', () => {
  const {logs, restarter} = make();
  restarter.restart('fixes'); restarter.restart('fixes');
  assert.equal(logs.length, 2);
  assert.match(logs[0], /restart: fixes/);
  assert.match(logs[1], /already under way/);
});

test('app.relaunch( is called only from lib/restart.js: a new caller must use the shared path', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const found = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      if (['node_modules', 'test', 'e2e', 'dist', 'out'].includes(entry.name) || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(m?js|cjs)$/.test(entry.name) && /\bapp\.relaunch\(/.test(fs.readFileSync(full, 'utf8').replace(/\/\/.*$/gm, ''))) found.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  walk(root);
  assert.deepEqual(found, ['lib/restart.js']);
});
