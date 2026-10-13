// A development copy says "extension changed: reload it" once per extension start when its folder changed after that start (lib/server-env.js
// extensionChangedNote): since the build stamps the version (scripts/extension-stamp.mjs), a pull no longer raises it, so Chrome's copy cannot reload itself.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EXTENSION_CHANGED, extensionChangedNote, newestExtensionFile} from '../lib/server-env.js';

test('changed after the extension started: said once; unchanged, another version or a new start: not', () => {
  const at = 1000;
  let {state, note} = extensionChangedNote({boot: 'b1', version: '0.9', at}, null, {latest: '0.9', newest: () => 900});
  assert.equal(note, '', 'nothing changed since this start');
  ({state, note} = extensionChangedNote({boot: 'b1', version: '0.9', at: 1030}, state, {latest: '0.9', newest: () => 1010}));
  assert.equal(note, EXTENSION_CHANGED);
  ({state, note} = extensionChangedNote({boot: 'b1', version: '0.9', at: 1060}, state, {latest: '0.9', newest: () => 1050}));
  assert.equal(note, '', 'once per start');
  ({state, note} = extensionChangedNote({boot: 'b2', version: '0.9', at: 2000}, state, {latest: '0.9', newest: () => 1050}));
  assert.equal(note, '', 'reloaded: its start is after the change');
  assert.equal(extensionChangedNote({boot: 'b3', version: '0.9.430', at}, null, {latest: '0.9.431', newest: () => 5000}).note, '',
    'another version: the extension reloads itself (tab-report.js), nothing to say');
});

test('the newest file of a folder, 0 when it cannot be read', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-dev-'));
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'a.js'), 'a');
  fs.writeFileSync(path.join(dir, 'sub', 'b.js'), 'b');
  fs.utimesSync(path.join(dir, 'sub', 'b.js'), new Date(5e12), new Date(5e12));
  assert.equal(newestExtensionFile(dir), 5e12);
  assert.equal(newestExtensionFile(path.join(dir, 'missing')), 0);
});
