// The Locations move on a store (owner, 17 Oct 2026): reads the Profile's Countries / Preferred cities / Relocation rows, compares them with the search
// settings' places (lib/locations-move.js), writes what agrees or is one-sided, and queues each conflict in settings.locationsConflicts with nothing
// written for it until the person picks (resolveLocation). Both pages are copied and the backup runs before anything is written; every written list is
// read back, else it throws with the copy's place. The Profile rows are never removed here: the old editors stay until crawl and scoring read the new
// source (spec step c). Works on every store (lib/store). Guarded by test/locations-store.test.js.
import fs from 'node:fs';
import path from 'node:path';
import {openStore} from './store/index.js';
import {itemsOf} from './profile-move.js';
import {fieldFor} from '../renderer/preferences-model.js';
import {applyLocations, classify, judgeProfile, readSide, resolveConflict} from './locations-move.js';
import {settleSame} from './locations-same.js';
import {publishSearchSettings} from './strategy-settings.js';
import * as backup from './backup.js';
import {keep} from './set-aside.js';

const SEARCH_FILE = 'config/search.json';
const KEYS = new Set(['countries', 'cities', 'relocation']);
const readSearch = storage => JSON.parse(storage.readText(SEARCH_FILE) || '{}');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The location rows of the Profile (not Home base: where you live is Your details'), as {label, value}.
export async function profileRows(storage, fetcher) {
  const outline = await openStore(storage, {fetcher}).page('profile').outline();
  return itemsOf(outline, 'profile').filter(item => KEYS.has(fieldFor(item.label)?.key)).map(({label, value}) => ({label, value}));
}

// The default writer: the file, then the Notion settings page when the caller has its deps (what editLists does).
const defaultWrite = async (storage, next, deps) => {
  storage.writeText(SEARCH_FILE, JSON.stringify(next, null, 2) + '\n');
  if (deps) await publishSearchSettings(storage, deps);
};

// The copy taken before anything is written: the Profile page and the search settings as they were, then the backup.
async function copyFirst(storage, {fetcher, now, run}) {
  const dir = path.join(storage.dir, 'before-locations', now.toISOString().slice(0, 19).replace(/[:T]/g, '-'));
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, 'profile.md'), await openStore(storage, {fetcher}).page('profile').text());
  fs.writeFileSync(path.join(dir, 'search.json'), storage.readText(SEARCH_FILE));
  return {dir, file: run(storage, {now}).file};
}

const readBack = (storage, resolved) => {
  const places = readSearch(storage).locations || {};
  const have = {preferred: places.top_tier, acceptable: places.country_wide, relocation: places.abroad};
  return Object.entries(resolved).filter(([kind]) => have[kind] !== undefined || kind === 'relocation')
    .filter(([kind, value]) => kind !== 'searchOverride' && !same(kind === 'relocation' ? value.places : value, have[kind] || [])).map(([kind]) => kind);
};

// → {moved: number of kinds written, conflicts, copy}. {moved: 0} with no AI answer or nothing to change. write: a test's writer.
export async function moveLocations(storage, {fetcher, ai = {}, deps = null, write = defaultWrite, backup: run = backup.run, now = new Date()} = {}) {
  const profile = await judgeProfile(await profileRows(storage, fetcher), ai);
  if (!profile) return {moved: 0, conflicts: []};
  const search = readSearch(storage);
  const plan = classify(search, profile);
  const {same: alike, conflicts} = await settleSame(plan.conflicts, ai);   // the same places in other words move silently, like an exact match
  const resolved = {...plan.resolved};
  for (const kind of alike) {
    const fragments = plan.conflicts.find(each => each.kind === kind).strategyFragments;
    resolved[kind] = kind === 'relocation' ? {mode: 'yes', places: fragments} : fragments;
  }
  storage.saveSettings({locationsConflicts: conflicts});
  const next = applyLocations(search, resolved);
  if (same(next, search)) return {moved: 0, conflicts};
  const copy = await copyFirst(storage, {fetcher, now, run});
  await write(storage, next, deps);
  const missing = readBack(storage, resolved);
  if (missing.length) throw new Error(`Locations move: ${missing.join(', ')} did not save; the Profile is untouched (the copy is in ${copy.dir})`);
  return {moved: Object.keys(resolved).length, conflicts, copy};
}

// A queue saved by an older build (17 Oct 2026: saved before the place-name fix, so the card showed raw patterns): each entry is read again on
// open: the crawl side as place names from its own patterns, and the same-meaning check for any not checked yet; the same places are resolved
// to the crawl's list (nothing changes in the search) and leave the queue. -> the queue as it is now.
export async function recheckQueue(storage, {ai = {}, deps = null, write = defaultWrite} = {}) {
  const queue = storage.settings().locationsConflicts || [];
  const read = queue.map(entry => {
    const fragments = entry.strategyFragments || entry.strategy || [];
    return {...entry, strategyFragments: fragments, strategy: readSide(fragments).shown};
  });
  if (!read.some(entry => !entry.checked) && same(read, queue)) return queue;
  const {same: kinds, conflicts} = await settleSame(read, ai);
  storage.saveSettings({locationsConflicts: [...conflicts, ...read.filter(entry => kinds.includes(entry.kind))]});
  for (const kind of kinds) await resolveLocation(storage, kind, 'strategy', {deps, write});
  return storage.settings().locationsConflicts || [];
}

// "Which is right?" for one kind: the pick is written and read back, then the question closes. → {ok, error}.
export async function resolveLocation(storage, kind, choice, {places = [], deps = null, write = defaultWrite} = {}) {
  const queue = storage.settings().locationsConflicts || [];
  if (!queue.some(each => each.kind === kind)) return {ok: false, error: 'That choice is no longer open'};
  let plan;
  try { plan = resolveConflict({resolved: {}, conflicts: queue}, kind, choice, {places}); } catch (error) { return {ok: false, error: error.message}; }
  const search = readSearch(storage);
  await write(storage, applyLocations(search, plan.resolved), deps);
  const missing = readBack(storage, plan.resolved);
  if (missing.length) return {ok: false, error: 'It did not save; nothing else changed'};
  setAsideReplaced(storage, search.locations || {}, readSearch(storage).locations || {});
  storage.saveSettings({locationsConflicts: plan.conflicts});
  return {ok: true};
}

// A pick that replaced a search list sets the old one aside (never lost): shown with Undo, which writes it back (restoreLocation).
const LISTS = [['top_tier', 'Preferred locations'], ['country_wide', 'Acceptable locations'], ['abroad', 'Relocation']];
function setAsideReplaced(storage, before, after) {
  const kept = new Set(after.search_override || []);
  keep(storage, LISTS.filter(([key]) => (before[key] || []).length && !same(before[key], after[key]) && !before[key].every(place => kept.has(place)))
    .map(([key, title]) => ({source: 'locations', title, label: title, value: readSide(before[key]).shown.join(', '),   // place names, never the patterns (restore keeps them)
      restore: {key, list: before[key], ...(key === 'abroad' ? {relocation: before.relocation} : {})}})));
}

// Undo of a set-aside list: written back to the search settings, read back. -> {ok, error}.
export async function restoreLocation(storage, entry, {deps = null, write = defaultWrite} = {}) {
  const {key, list, relocation} = entry.restore || {};
  if (!LISTS.some(([each]) => each === key) || !Array.isArray(list)) return {ok: false, error: 'That list has no place to go back to'};
  const search = readSearch(storage);
  const locations = {...search.locations, [key]: list, ...(relocation ? {relocation} : {})};
  await write(storage, {...search, locations}, deps);
  return same(readSearch(storage).locations?.[key], list) ? {ok: true} : {ok: false, error: 'It did not save'};
}
