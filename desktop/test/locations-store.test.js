// The Locations move on a real store (sqlite): matching and unset kinds are written to the search settings, a conflict waits in settings.locationsConflicts
// with nothing written for it, the Profile rows are never removed here (the old editors stay until the consumers read the new source), the pages are
// copied before anything is written, and "no AI" changes nothing. Resolving a conflict writes the person's pick and clears it from the queue.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import * as store from '../lib/store/index.js';
import {moveLocations, recheckQueue, resolveLocation} from '../lib/locations-store.js';

const plainCrypto = {encrypt: v => v, decrypt: v => v};
const PROFILE = '## Hard constraints\n\n| Constraint | Value |\n|---|---|\n| Countries | Switzerland (anywhere) |\n| Home base | Zurich |\n| Preferred cities | Zurich, Zug |\n| Relocation | Within Europe |\n| Work permit | EU citizen |\n';
const SEARCH = {role_keywords: ['sre'], remote_excluded_regions: ['canada'], locations: {top_tier: ['zurich'], country_wide: ['netherlands', 'germany'], abroad: []}};
const ai = (answer, calls = []) => ({client: {messages: {create: async request => { calls.push(request); return {content: [{type: 'text', text: JSON.stringify(answer)}]}; }}}});
const ANSWER = {preferred: ['Zurich', 'Zug'], acceptable: ['Switzerland'], relocation: 'yes', destinations: ['Europe']};

async function fresh() {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-loc-')), plainCrypto);
  storage.saveSettings({store: 'sqlite'});
  await store.openStore(storage).page('profile').write(PROFILE);
  storage.writeText('config/search.json', JSON.stringify(SEARCH));
  return storage;
}
const searchOf = storage => JSON.parse(storage.readText('config/search.json'));
const noBackup = () => ({file: 'backup.zip'});

test('no AI: nothing is written, nothing is queued', async () => {
  const storage = await fresh();
  const result = await moveLocations(storage, {ai: {}, backup: noBackup});
  assert.equal(result.moved, 0);
  assert.deepEqual(searchOf(storage), SEARCH);
  assert.equal(storage.settings().locationsConflicts, undefined);
});

test('the move writes what agrees or is one-sided, queues the conflict untouched, keeps every Profile row', async () => {
  const storage = await fresh();
  const profileBefore = await store.openStore(storage).page('profile').text();
  const result = await moveLocations(storage, {ai: ai(ANSWER), backup: noBackup});
  const search = searchOf(storage);
  assert.deepEqual(search.locations.country_wide, ['netherlands', 'germany']);   // the conflict: not written
  assert.deepEqual(search.locations.top_tier, ['zurich']);                         // Zurich vs Zurich + Zug differ: a conflict too, not written
  assert.deepEqual(search.locations.relocation, ['yes']);                          // settings said nothing: the Profile's Yes moves
  assert.deepEqual(search.locations.abroad, ['Europe']);
  assert.deepEqual(search.role_keywords, ['sre']);
  assert.ok(result.copy.dir && fs.existsSync(path.join(result.copy.dir, 'profile.md')) && fs.existsSync(path.join(result.copy.dir, 'search.json')));
  assert.equal(await store.openStore(storage).page('profile').text(), profileBefore);   // Profile rows stay (step c removes them)
  assert.deepEqual(storage.settings().locationsConflicts.map(each => each.kind).sort(), ['acceptable', 'preferred']);
});

test('resolving a conflict writes the pick, reads it back, clears the queue', async () => {
  const storage = await fresh();
  await moveLocations(storage, {ai: ai(ANSWER), backup: noBackup});
  const result = await resolveLocation(storage, 'acceptable', 'profile');
  assert.equal(result.ok, true);
  assert.deepEqual(searchOf(storage).locations.country_wide, ['Switzerland']);
  assert.equal((storage.settings().locationsConflicts || []).some(each => each.kind === 'acceptable'), false);
  assert.equal((await resolveLocation(storage, 'acceptable', 'profile')).ok, false);   // no longer open
  const separate = await fresh();
  await moveLocations(separate, {ai: ai(ANSWER), backup: noBackup});
  await resolveLocation(separate, 'acceptable', 'separate');
  assert.deepEqual(searchOf(separate).locations.search_override, ['netherlands', 'germany']);
});

test('a write that does not read back stops with the copy named and the queue kept', async () => {
  const storage = await fresh();
  await assert.rejects(moveLocations(storage, {ai: ai(ANSWER), backup: noBackup, write: () => {}}), /did not save/);
});

// 17 Oct 2026: a queue saved before the place-name fix kept raw patterns, so the card still showed "\bz[uü]rich\b, "zug" ..." after the fix landed.
const OLD_QUEUE = [
  {kind: 'preferred', strategy: ['\\bz[uü]rich\\b', '\\bwinterthur\\b', '"zug"'], profile: ['Zurich and surroundings']},
  {kind: 'relocation', strategy: ['\\bberlin\\b', '\\blondon\\b', '\\bparis\\b'], profile: ['Berlin', 'London'], profileMode: 'yes'}];

test('a queue saved by an older build is read again on open: place names, never patterns; the same places leave it, the search unchanged', async () => {
  const storage = await fresh();
  const search = {...SEARCH, locations: {...SEARCH.locations, top_tier: OLD_QUEUE[0].strategy, abroad: OLD_QUEUE[1].strategy}};
  storage.writeText('config/search.json', JSON.stringify(search));
  storage.saveSettings({locationsMovedAt: '2026-10-17T18:52:01.036Z', locationsConflicts: OLD_QUEUE});
  const writes = [];
  const write = (s, next) => { writes.push(next); s.writeText('config/search.json', JSON.stringify(next)); };
  const offline = await recheckQueue(storage, {write});   // no AI: names only, nothing resolved
  assert.deepEqual(offline.map(each => each.strategy), [['zürich', 'winterthur', 'zug'], ['berlin', 'london', 'paris']]);
  assert.deepEqual(offline[0].strategyFragments, OLD_QUEUE[0].strategy, 'the patterns are kept for the crawl');
  assert.equal(writes.length, 0);
  const answers = [{onlyStrategy: [], onlyProfile: []}, {onlyStrategy: ['paris'], onlyProfile: []}];
  const client = {messages: {create: async () => ({content: [{type: 'text', text: JSON.stringify(answers.shift())}]})}};
  const now = await recheckQueue(storage, {ai: {client}, write});
  assert.deepEqual(now.map(each => each.kind), ['relocation']);
  assert.deepEqual(now[0].onlyStrategy, ['paris']);
  assert.deepEqual(searchOf(storage).locations.top_tier, OLD_QUEUE[0].strategy, 'the crawl keeps its own list');
  for (const entry of storage.settings().locationsConflicts) for (const name of entry.strategy) assert.doesNotMatch(name, /[\\[\]"|]/);
  assert.equal(storage.settings().locationsConflicts.length, 1);
});
