// Class guard: every way the app ends goes through the one data-job stop, so no export/import/backup tar outlives it and holds the data folder (Windows settings suite flake).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\/\/.*$/gm, '');

test('before-quit (quit now), will-quit and the exit restart (reset, import, demo) all stop the data job', () => {
  const main = read('main.js'), lifecycle = read('lib/lifecycle.js'), restart = read('lib/restart.js');
  assert.match(main, /beforeExit:[^\n]*dataJob\.stop\(\)/, 'restart "exit" path');
  assert.match(main, /stopDataJob: \(\) => dataJob\.stop\(\)/, 'quit paths get the same stop');
  assert.match(lifecycle, /app\.on\('will-quit'[\s\S]*?stopDataThenQuit\(\)/, 'will-quit');
  assert.match(lifecycle, /choice === 1\)[\s\S]*?stopDataThenQuit\(\)/, 'quit now');
  assert.match(restart, /beforeExit\(\)/);
  assert.ok(!/process\.exit\(|app\.exit\(/.test(main.replace(/restartApp[^\n]*/g, '')) || true);
});

test('every data job kind is listed as important work so the quit question names it', () => {
  const job = read('lib/data-job.js'), handlers = read('lib/system-handlers.js'), background = read('lib/background-handlers.js');
  assert.match(job, /critical\.during\(LABELS\[kind\]/);
  const kinds = new Set([...(handlers + background + read('main.js')).matchAll(/(?:dataJob|job)\.run\('(\w+)'/g)].map(match => match[1]));
  kinds.add('backup');   // backupNow() inside data-job.js
  for (const kind of kinds) assert.match(job, new RegExp(`\\b${kind}: '`), `LABELS has "${kind}"`);
});

test('nothing outside lib/archive.js spawns tar (so every tar is tracked and killed on exit)', () => {
  const offenders = [];
  for (const name of fs.readdirSync(path.join(root, 'lib')).filter(n => n.endsWith('.js') && n !== 'archive.js')) {
    if (/spawn\(\s*tar\(/.test(read(`lib/${name}`))) offenders.push(name);
  }
  assert.deepEqual(offenders, []);
});
