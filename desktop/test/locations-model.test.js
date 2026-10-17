// Strategy → Locations card, its words and edits as a pure model (owner, 17 Oct 2026): relocation is Yes / No / Not specified, remote work says what it means
// in plain words, an active search-only list is shown with a reset, and the reset is one edit that empties it. Screen wiring: test/locations-card.test.js.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {RELOCATION, coverage, relocationNow, relocationWords, remoteWords, resetCoverage} from '../renderer/locations-model.js';

const data = extra => ({lists: {places: [{fragment: 'zurich', label: 'zurich'}], country: [{fragment: 'switzerland', label: 'switzerland'}], abroad: [], searchOverride: []}, relocation: 'unspecified', ...extra});

test('relocation offers exactly Yes, No and Not specified, and No / Not specified are values', () => {
  assert.deepEqual(RELOCATION.map(([, label]) => label), ['Yes', 'No', 'Not specified']);
  assert.equal(relocationNow(data({relocation: 'no'}), {}), 'no');
  assert.equal(relocationNow(data({relocation: 'no'}), {relocation: {set: 'yes'}}), 'yes', 'the draft wins while editing');
  assert.equal(relocationNow(data({}), {}), 'unspecified');
});

test('relocation says its mode and the places only for Yes', () => {
  const abroad = [{fragment: 'berlin', label: 'berlin'}];
  assert.equal(relocationWords('yes', abroad), 'Yes · Berlin');
  assert.equal(relocationWords('yes', []), 'Yes');
  assert.equal(relocationWords('no', abroad), 'No');
  assert.equal(relocationWords('unspecified', []), 'Not specified');
});

test('remote work reads as what it means, not as a list of regions', () => {
  assert.equal(remoteWords(true, ['Switzerland']), 'Jobs that allow working from Switzerland');
  assert.equal(remoteWords(true, []), 'Remote jobs count as one of your locations');
  assert.equal(remoteWords(false, ['Switzerland']), 'Only jobs based in your locations');
  for (const words of [remoteWords(true, ['Switzerland']), remoteWords(false, [])]) assert.doesNotMatch(words, /Counts|not from|eligib/i);
});

test('custom search coverage shows while Advanced is collapsed, and Reset to preferences empties it in one edit', () => {
  assert.deepEqual(coverage(data({})), {active: false, places: [], fragments: []});
  const now = coverage(data({lists: {...data({}).lists, searchOverride: [{fragment: 'netherlands', label: 'netherlands'}, {fragment: 'germany', label: 'germany'}]}}));
  assert.equal(now.active, true);
  assert.deepEqual(now.places, ['Netherlands', 'Germany']);
  assert.deepEqual(resetCoverage(now), {searchOverride: {remove: ['netherlands', 'germany']}});
});
