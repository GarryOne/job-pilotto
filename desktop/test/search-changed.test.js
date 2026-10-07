// "Your search changed" shows after a Strategy save and until a refresh has finished (owner, 7 Oct 2026).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

test('shown after a save, gone once a refresh finished after it', async () => {
  const source = fs.readFileSync(new URL('../renderer/search-changed.js', import.meta.url), 'utf8');
  const fn = source.match(/export const searchChanged = (settings => [^\n]+);/)[1];
  const searchChanged = eval(fn);
  assert.equal(searchChanged({}), false, 'never edited');
  assert.equal(searchChanged({searchChangedAt: '2026-10-07T12:30:00Z', lastSearchAt: '2026-10-07T12:01:00Z'}), true);
  assert.equal(searchChanged({searchChangedAt: '2026-10-07T12:30:00Z'}), true, 'no refresh yet at all');
  assert.equal(searchChanged({searchChangedAt: '2026-10-07T12:30:00Z', lastSearchAt: '2026-10-07T12:40:00Z'}), false);
  const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  assert.match(main, /if \(result\.changed\.length\) storage\.saveSettings\(\{searchChangedAt:/, 'a Strategy save that changed something sets it');
});
