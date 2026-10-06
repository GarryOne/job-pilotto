// The window ↔ app bridge stays whole: every window.pilot.* the pages use is in preload.cjs, and every action
// preload.cjs exposes has its ipcMain.handle in main.js. A missing half shows up here, not as "No handler
// registered" or "window.pilot.x is not a function" on the owner's screen.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';

const here = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(here, file), 'utf8');
const files = dir => fs.readdirSync(path.join(here, dir)).filter(name => name.endsWith('.js')).map(name => `${dir}/${name}`);
const preload = read('preload.cjs');
const exposed = new Set([...preload.matchAll(/^\s*(\w+):/gm), ...preload.matchAll(/[,{]\s*(\w+):\s*(?:call\(|callback|\()/g)].map(m => m[1]));
const actions = [...preload.matchAll(/call\('(\w+)'\)/g)].map(m => m[1]);
const handled = new Set([...(read('main.js') + read('lib/session-handlers.js')).matchAll(/(?:(?:ipcMain|checkedSessions)\.(?:handle|on)|handleImportant)\('(\w+)'/g)].map(m => m[1]));

test('every window.pilot.* used by the window exists in preload.cjs', () => {
  const used = new Set();
  for (const file of [...files('renderer'), ...files('renderer/pages')]) {
    for (const m of read(file).matchAll(/window\.pilot\.(\w+)/g)) used.add(`${m[1]}|${file}`);
  }
  const missing = [...used].filter(entry => !exposed.has(entry.split('|')[0]));
  assert.deepEqual(missing, [], 'add these to preload.cjs (and a handler in main.js)');
});

test('every action preload.cjs exposes has its handler in main.js', () => {
  assert.deepEqual(actions.filter(name => !handled.has(name)), [], 'add ipcMain.handle(name, …) in main.js');
});
