// Every key panel in Settings can be saved and shows its "saved" hint (#319: the Brave panel's Save button had no handler, and its hint was never sent).
// Guards: renderer/index.html (the panels), renderer/pages/connections.js (the Save handlers), lib/apply-handlers.js (secretHints).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const html = read('renderer/index.html'), connections = read('renderer/pages/connections.js'), handlers = read('lib/apply-handlers.js');
const OWN_HANDLER = new Set(['notion', 'telegram']);   // saved by their own flows (connections.js notion, profile.js telegram)

test('every key panel Save button has a handler', () => {
  const ids = [...html.matchAll(/id="set-([a-z0-9-]+)-save"/g)].map(match => match[1]).filter(id => !OWN_HANDLER.has(id));
  assert.ok(ids.length >= 7, 'the panels were found');
  for (const id of ids) assert.ok(connections.includes(`['${id}', '`), `set-${id}-save has a handler in connections.js`);
});

test('every secret a panel shows has a hint', () => {
  const names = [...new Set([...html.matchAll(/data-secret="([A-Z_]+)"/g)].map(match => match[1]))];
  const hints = handlers.match(/ipcMain\.handle\('secretHints'[\s\S]*?\.map\(/)[0];
  for (const name of names) assert.ok(hints.includes(`'${name}'`), `${name} is in secretHints`);
});
