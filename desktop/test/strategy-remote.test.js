// A drafted search skips remote jobs open only to other parts of the world, whatever the AI proposed (lib/strategy.js withRemoteDefaults).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DEFAULT_REMOTE_EXCLUDED, withRemoteDefaults} from '../lib/strategy.js';

const matches = (search, text) => search.remote_excluded_regions.some(fragment => new RegExp(fragment, 'i').test(text));

test('an empty or short drafted list gets the standard regions, so "Remote (United States | Canada)" is skipped for a user in Europe', () => {
  const draft = {locations: {top_tier: ['bucharest'], country_wide: ['romania'], abroad: ['remote europe']}, remote_excluded_regions: []};
  const search = withRemoteDefaults(draft);
  assert.ok(matches(search, 'Remote (United States | Canada)'));
  assert.ok(matches(search, 'Remote - Latin America'));
  assert.ok(!matches(search, 'Remote (Europe)'));
  assert.ok(!matches(search, 'Remote - EMEA'));
  assert.deepEqual(withRemoteDefaults({locations: draft.locations}).remote_excluded_regions, DEFAULT_REMOTE_EXCLUDED);   // no list at all
});

test('regions the user\'s own places are in are not skipped, and the AI\'s own entries are kept once', () => {
  const draft = {locations: {top_tier: ['toronto'], country_wide: ['canada'], abroad: []}, remote_excluded_regions: ['\\bapac\\b', 'my own region']};
  const search = withRemoteDefaults(draft);
  assert.ok(!matches(search, 'Remote (Canada)'), 'a user in Canada keeps Canadian remote jobs');
  assert.ok(matches(search, 'Remote (United States)'));
  assert.equal(search.remote_excluded_regions.filter(fragment => fragment === '\\bapac\\b').length, 1);
  assert.ok(search.remote_excluded_regions.includes('my own region'));
  assert.equal(withRemoteDefaults(search), search, 'nothing left to add: the same object comes back');
});
