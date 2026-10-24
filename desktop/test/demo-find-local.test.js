// In the demo, Find jobs always runs on this Mac (owner's hero session, 24 Oct 2026: the demo's settings name an Always-on repo, so a press on the Find
// jobs card dispatched to GitHub and nothing happened). Guards: the demo never takes a cloud branch, and no handler decides "cloud" by itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {cloudRuns} from '../lib/demo.js';

const root = path.resolve(import.meta.dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const demoSettings = JSON.parse(read('demo/settings.json'));

test('the demo settings do name an Always-on repo (so the demo must not follow it)', () => {
  assert.ok(demoSettings.cloud?.repo, 'the fixture the bug came from');
});

test('a demo never runs in the cloud, a real install with Always on does', () => {
  assert.equal(cloudRuns(demoSettings, true), false);
  assert.equal(cloudRuns({...demoSettings, lastSearchAt: ''}, true), false);
  assert.equal(cloudRuns(demoSettings, false), true);
  assert.equal(cloudRuns({}, false), false);
  assert.equal(cloudRuns(null, false), false);
});

test('main.js decides "cloud" through cloudRuns, and every Find jobs entry (card, header button, ⌘K: one refresh handler) asks that, not the settings', () => {
  assert.match(read('main.js'), /const cloud = \(\) => demo\.cloudRuns\(storage\?\.settings\(\), DEMO\)/);
  const handlers = read('lib/jobs-handlers.js');
  const refresh = handlers.split("ipcMain.handle('refresh'")[1].split('\n  });')[0];
  assert.match(refresh, /\bcloud\(\)/, 'the refresh handler asks cloud()');
  assert.doesNotMatch(refresh, /settings\(\)\.cloud/, 'and never the settings');
});

test('every dispatch to GitHub sits behind cloud(), never behind the settings read on its own', () => {
  const files = fs.readdirSync(path.join(root, 'lib')).filter(name => name.endsWith('.js') && name !== 'cloud-dispatch.js');
  const bad = [];
  for (const name of files) {
    const lines = read(`lib/${name}`).split('\n');
    lines.forEach((line, i) => {
      if (!/\bdispatchCloud\(/.test(line) || /^\s*(const|function|export|async)\b.*dispatchCloud\s*[=(]/.test(line) && /=>|function/.test(line) && !/await|return|\.then/.test(line)) return;
      const before = lines.slice(Math.max(0, i - 8), i + 1).filter(each => !/appLog\(/.test(each)).join('\n');   // a log line may print the repo; it decides nothing
      if (!/\bcloud\(\)/.test(before) || /settings\(\)\.cloud\?\.repo/.test(before)) bad.push(`${name}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, [], 'a dispatch decided by the settings in the demo goes to GitHub');
});
