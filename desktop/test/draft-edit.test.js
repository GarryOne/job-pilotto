// The setup draft edited through the Strategy cards' own edit code: lists, one-value settings and Profile blocks, in memory only.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {editDraftLists, editDraftText} from '../lib/draft-edit-handlers.js';

const draft = {search: {target_roles: [{title: 'Nurse', also: []}], locations: {top_tier: ['brno'], country_wide: [], abroad: []}, level: ['junior']}, preferences: {work_rights: []}};

test('list edits land in the draft exactly as they would in the saved settings', () => {
  const out = editDraftLists(draft, {places: {add: ['Ostrava'], remove: ['brno']}, rights: {add: ['EU'], remove: []}, relocation: {set: 'yes'}, minScore: {set: 55}});
  assert.deepEqual(out.search.locations.top_tier, ['ostrava']);
  assert.deepEqual(out.preferences.work_rights, ['eu']);
  assert.deepEqual(out.search.locations.relocation, ['yes']);
  assert.equal(out.preferences.digest_min_score, 55);
  assert.deepEqual(draft.search.locations.top_tier, ['brno'], 'the input draft is not changed');
});

test('roles and the search level edit like the saved ones', () => {
  const out = editDraftLists(draft, {roles: {add: ['Ward Nurse'], remove: []}, level: {set: 'senior'}});
  assert.deepEqual(out.search.target_roles.map(role => role.title), ['Nurse', 'Ward Nurse']);
  assert.deepEqual(out.search.level, ['senior']);
});

test('nothing valid asked: nothing changes', () => {
  assert.deepEqual(editDraftLists(draft, {places: {add: [], remove: []}}).changed, []);
});

test('a Profile block edit changes the draft text only', async () => {
  const text = '## Work\n- Work mode: Hybrid\n- Languages: English\n';
  const done = await editDraftText(text, [{op: 'text', id: 'L1', value: 'Work mode: Remote', was: 'Work mode: Hybrid'}]);
  assert.match(done.markdown, /Work mode: Remote/);
  assert.equal(done.missing.length, 0);
});
