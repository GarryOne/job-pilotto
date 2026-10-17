// Strategy → Locations card wiring (owner, 17 Oct 2026): every location row the Profile used to hold is owned by the card (the class), relocation and the
// custom-coverage line exist in both modes, the old wording is gone, and ⌘K reaches the card (the reset only while a search-only list is active).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {FIELDS} from '../renderer/preferences-model.js';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const card = read('renderer/pages/strategy-targets.js'), nav = read('renderer/pages/nav.js');
// The card's lists as [name, label], read from the source (importing the page needs the whole app's DOM).
const lists = [...card.matchAll(/\['(places|country|abroad|rights)', '([^']+)', '[^']+'\]/g)].map(([, name, label]) => [name, label]);

// The Profile row each Locations list or choice replaced: Countries → acceptable, Preferred cities → preferred, Relocation → the Yes / No / Not specified choice.
const OWNER = {countries: 'country', cities: 'places', relocation: 'abroad'};

test('every Profile location row that left Job preferences is owned by a Locations list or choice', () => {
  const moved = FIELDS.filter(field => field.editedIn === 'locations');
  assert.deepEqual(moved.map(field => field.key).sort(), Object.keys(OWNER).sort(), 'a new moved row needs its owner here');
  for (const field of moved) assert.ok(lists.some(([name]) => name === OWNER[field.key]), `${field.key} → ${OWNER[field.key]}`);
  assert.match(card, /relocationChoice\(renderTargets\)/);
});

test('the card says Preferred / Acceptable / Remote work, and no longer the old words', () => {
  assert.deepEqual(lists.map(([, label]) => label).slice(0, 2), ['Preferred locations', 'Acceptable locations']);
  for (const old of ['Priority locations', 'Additional regions', 'Locations & eligibility']) assert.ok(!card.includes(old), old);
  assert.match(card, /'Remote work'/);
  assert.doesNotMatch(card, /'Remote jobs'\)/);
});

test('the custom search coverage line is drawn for both modes, before the lists', () => {
  assert.match(card, /if \(key === 'places'\) card\.append\(\.\.\.\[coverageLine\(reloadTargets\)\]\.filter\(Boolean\)\);/);
  assert.ok(card.indexOf('coverageLine(reloadTargets)') < card.indexOf('VIEWS[key]()'));
  assert.match(read('renderer/pages/locations-card.js'), /Custom search coverage active ·/);
  assert.match(read('renderer/pages/locations-card.js'), /Reset to preferences/);
});

test('⌘K reaches Locations; Reset search coverage only while it is active; Job preferences no longer claims the moved rows', () => {
  assert.match(nav, /add\('Strategy', 'Locations'/);
  assert.match(nav, /if \(shared\.coverageActive\) add\('Strategy', 'Reset search coverage'/);
  assert.match(card, /shared\.coverageActive = coverage\(strategyState\.lastStrategy\)\.active/);
  assert.doesNotMatch(nav.match(/add\('Strategy', 'Job preferences'.*\n?.*\n/)[0], /countries|relocation/);
});
