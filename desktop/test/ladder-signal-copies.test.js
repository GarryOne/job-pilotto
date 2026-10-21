// Every copy of the ladder's signal list is the list of extension/ladder/core.js (invariant 1: the fixed lists). The copies exist where core.js cannot be imported: the app's
// learning (a classic script), the site's admin parser, the CI pool's run parser and the ladder fixtures' field note. A signal added to core.js and missed in one copy fails here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {assertSiteAccepts, siteTest} from './site-private.js';
import {SIGNALS} from '../../extension/ladder/core.js';

const read = file => fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const listIn = (file, name = 'SIGNALS') => {
  const found = new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(read(file));
  assert.ok(found, `${file}: no "const ${name} = [...]"`);
  return [...found[1].matchAll(/'([a-z_]+)'/g)].map(item => item[1]);
};
const HANDED_ON = SIGNALS.filter(signal => signal !== 'confident');   // the signals that make a rung hand the page on

test('the app\'s learning keeps the full list', () => {
  assert.deepEqual(listIn('desktop/lib/ladder/learning.js'), SIGNALS);
});

test('the CI pool\'s run parser reads every signal that hands a page on', () => {
  assert.deepEqual(listIn('desktop/e2e/lib/record-sites.mjs'), HANDED_ON);
});

siteTest('the site\'s admin parser reads every signal that hands a page on', () => {
  assertSiteAccepts(HANDED_ON, listIn('admin/applying.js'), 'signals');   // the site may know more (it lands first)
});

test('the ladder fixtures\' field note names the same signals', () => {
  const note = /`signal` \(([a-z_|]+)\)/.exec(read('desktop/e2e/lib/ladder-fixtures.mjs'));
  assert.ok(note, 'ladder-fixtures.mjs: the `signal` (a|b|c) note');
  assert.deepEqual(note[1].split('|'), HANDED_ON);
});
