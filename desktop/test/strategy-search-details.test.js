// Strategy → More search settings (lib/strategy-edit.js): what only the ⚙️ Search settings page had, edited in the app on every store.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {applyEdits, cleanEdits, edited} from '../lib/strategy-edit.js';
import {dirtyLists} from '../renderer/strategy-parts.js';

const files = {search: {role_keywords: ['sre'], remote_excluded_regions: ['latam'], board_discovery_keywords: ['devops'],
  google_jobs: {queries: ['sre'], locations: [{location: 'Zurich,Zurich,Switzerland', language: 'de'}], country: 'ch'}, level: ['senior']},
preferences: {excluded_companies: ['Acme AG'], digest_min_score: 50}};

test('the five lists: companies as typed, regions and employer words as matches, Google Jobs places as "Location · language"', () => {
  const edits = cleanEdits({skip: {add: ['Foo GmbH'], remove: ['Acme AG']}, remoteSkip: {add: ['APAC']}, finders: {add: ['Platform']},
    gqueries: {add: ['platform engineer']}, gplaces: {add: ['Geneva,Geneva,Switzerland · fr'], remove: ['Zurich,Zurich,Switzerland · de']}});
  assert.deepEqual(edits.skip.add, ['Foo GmbH']);
  assert.deepEqual(edits.remoteSkip.add, ['apac']);
  const next = applyEdits(files, edits);
  assert.deepEqual(next.preferences.excluded_companies, ['Foo GmbH']);
  assert.deepEqual(next.search.remote_excluded_regions, ['latam', 'apac']);
  assert.deepEqual(next.search.board_discovery_keywords, ['devops', 'platform']);
  assert.deepEqual(next.search.google_jobs, {queries: ['sre', 'platform engineer'], locations: [{location: 'Geneva,Geneva,Switzerland', language: 'fr'}], country: 'ch'});
  assert.ok(edited(next, edits));
  assert.ok(!edited(files, edits));
  assert.deepEqual(files.search.google_jobs.queries, ['sre'], 'the inputs are not changed');
});

test('level and minimum fit score are set, checked, and only from the known values', () => {
  const edits = cleanEdits({level: {set: 'lead'}, minScore: {set: 65}});
  const next = applyEdits(files, edits);
  assert.deepEqual(next.search.level, ['lead']);
  assert.equal(next.preferences.digest_min_score, 65);
  assert.ok(edited(next, edits));
  assert.deepEqual(applyEdits(files, cleanEdits({level: {set: ''}})).search.level, [], 'Any: no level');
  assert.deepEqual(cleanEdits({level: {set: 'boss'}, minScore: {set: 101}}), {});
  assert.deepEqual(cleanEdits({minScore: {set: '60'}}), {}, 'a number, not text');
  assert.deepEqual([...dirtyLists({level: {set: 'mid'}, minScore: {set: 40}})], ['level', 'minScore'], 'they mark the card edited');
});

test('no Google Jobs block is added when it is not edited', () => {
  const plain = {search: {role_keywords: []}, preferences: {}};
  assert.equal('google_jobs' in applyEdits(plain, cleanEdits({skip: {add: ['Foo']}})).search, false);
  assert.deepEqual(applyEdits(plain, cleanEdits({gqueries: {add: ['sre']}})).search.google_jobs, {queries: ['sre']});
});
