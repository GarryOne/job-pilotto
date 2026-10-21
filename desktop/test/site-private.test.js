// The one-way contract helpers (site-private.js): the site may run ahead of public, never behind. Owner, 21 Oct 2026: reds only because a repo pair was landing.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {assertSiteAccepts, siteMissing} from './site-private.js';

test('the site ahead of public is green', () => {
  assertSiteAccepts(['a', 'b'], ['b', 'a', 'new_on_site'], 'steps');
});

test('public ahead of the site is red and names what is missing', () => {
  assert.deepEqual(siteMissing(['a', 'new_in_public'], ['a']), ['new_in_public']);
  assert.throws(() => assertSiteAccepts(['a', 'new_in_public'], ['a'], 'steps'), /new_in_public/);
});
