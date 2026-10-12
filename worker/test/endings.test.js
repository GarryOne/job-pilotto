// The outcome contract's fixed endings (extension/ladder/endings.js): one list every part imports (the extension's dead ends, the app, the pool's classifier desktop/e2e/lib/ending.mjs,
// the site's Resolution tile), never copied words. Pure: no chrome API, so a node test and the site can load it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {ENDINGS, UNRESOLVED, isEnding, resolved} from '../../extension/ladder/endings.js';

test('the endings are a fixed list of seven, unresolved last; resolved is every ending but unresolved', () => {
  assert.deepEqual(ENDINGS, ['ready', 'told', 'handed', 'blind', 'data_missing', 'site_broken', 'unresolved']);
  assert.equal(UNRESOLVED, ENDINGS.at(-1));
  assert.deepEqual(ENDINGS.filter(resolved), ['ready', 'told', 'handed', 'blind', 'data_missing', 'site_broken']);
  for (const nope of ['', 'held by the test', 'Ready', null, undefined, 'other']) { assert.equal(isEnding(nope), false); assert.equal(resolved(nope), false); }
});

test('the list is pure: no chrome API, no storage, no import', () => {
  const source = fs.readFileSync(new URL('../../extension/ladder/endings.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bchrome\.|localStorage|^import /m);
});
