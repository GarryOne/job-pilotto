// Strategy → Locations edits (owner, 17 Oct 2026): relocation Yes/No/Not specified is a value, the search-only list can be set and reset, and the
// one list a card edits is the one the crawl and the scores read. Guarded here, with test/locations-card.test.js for the screen.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {applyEdits, cleanEdits, edited} from '../lib/strategy-edit.js';

const files = () => ({search: {locations: {top_tier: ['zurich'], country_wide: ['switzerland'], abroad: ['berlin']}}, preferences: {}});

test('relocation is set as Yes, No or Not specified; anything else is dropped', () => {
  assert.deepEqual(cleanEdits({relocation: {set: 'no'}}), {relocation: {set: 'no'}});
  assert.deepEqual(cleanEdits({relocation: {set: 'maybe'}}), {});
  for (const mode of ['yes', 'no', 'unspecified']) {
    const edits = cleanEdits({relocation: {set: mode}});
    const next = applyEdits(files(), edits);
    assert.deepEqual(next.search.locations.relocation, [mode]);
    assert.deepEqual(next.search.locations.abroad, ['berlin'], 'the places abroad are kept, whatever the mode');
    assert.ok(edited(next, edits));
  }
});

test('the search-only list is added to, removed from and reset to the preferences (an empty list is the reset)', () => {
  const added = applyEdits(files(), cleanEdits({searchOverride: {add: ['Netherlands', 'Germany']}}));
  assert.deepEqual(added.search.locations.search_override, ['netherlands', 'germany']);
  assert.deepEqual(added.search.locations.top_tier, ['zurich'], 'the preferences are untouched');
  const reset = applyEdits(added, cleanEdits({searchOverride: {remove: ['netherlands', 'germany']}}));
  assert.deepEqual(reset.search.locations.search_override, []);
});
