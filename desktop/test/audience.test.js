// "Is this candidate technical?": the window's rule must be the engine's rule (src/coverage.py looks_technical), row by row of one shared table.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {clearlyTechnical, looksTechnical} from '../renderer/audience.js';

const cases = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'audience_cases.json'), 'utf8')).cases;

test('the window and the engine agree on every case of the shared table', () => {
  for (const {keywords, technical} of cases) assert.equal(looksTechnical(keywords), technical, JSON.stringify(keywords));
});

test('IT-only guidance needs a clearly technical candidate: no roles known is not enough', () => {
  assert.equal(clearlyTechnical([]), false);
  assert.equal(clearlyTechnical(['\\bsre\\b']), true);
  assert.equal(clearlyTechnical(['registered nurse']), false);
});

// ---- where the candidate is ----
import {contactHints, plainPlace, swissPlaces} from '../renderer/audience.js';

test('the window and the engine agree on which searches have Swiss places', () => {
  const table = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'swiss_cases.json'), 'utf8')).cases;
  for (const {places, swiss} of table) assert.equal(swissPlaces(places), swiss, JSON.stringify(places));
});

test('a place fragment reads as plain words', () => {
  assert.equal(plainPlace('\\bz[uü]rich\\b'), 'Zürich');
  assert.equal(plainPlace('manchester'), 'Manchester');
  assert.equal(plainPlace('st. gallen'), 'St Gallen');
  assert.equal(plainPlace('new york'), 'New York');
});

test('the details form shows the candidate\'s own example, and the Swiss field only for a Swiss candidate', () => {
  const uk = contactHints({places: ['manchester', 'united kingdom']}, {});
  assert.deepEqual([uk.locationExample, uk.showOrigin], ['e.g. Manchester', false]);
  const ch = contactHints({places: ['\\bz[uü]rich\\b', 'switzerland']}, {});
  assert.deepEqual([ch.locationExample, ch.showOrigin], ['e.g. Zürich', true]);
  assert.equal(contactHints({places: ['manchester']}, {place_of_origin: 'Bern'}).showOrigin, true, 'a value already there is never hidden');
  const none = contactHints({}, {});
  assert.deepEqual([none.locationExample, none.showOrigin], ['e.g. your town or city', false]);
  assert.match(uk.dateExample, /Dec 1990/, 'a date example that names its month: no day-month order to assume');
});

test('the GitHub link is asked only of a technical candidate, or one who already has it', () => {
  assert.equal(contactHints({technical: false}, {}).showGithub, false);
  assert.equal(contactHints({}, {}).showGithub, false);
  assert.equal(contactHints({technical: true}, {}).showGithub, true);
  assert.equal(contactHints({technical: false}, {github: 'https://github.com/x'}).showGithub, true);
});
