// The "your search may be too narrow" card: words and chips from the engine's numbers, and when it stays quiet.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {coverageCard} from '../renderer/coverage-card.js';

const verdict = (extra = {}) => ({narrow: true, share: 164 / 3142, matched: 164, in_places: 3142, fetched: 10646, feeds: 130, at: '2026-10-02T10:00:00+00:00',
  suggestions: [{term: 'software engineer', count: 149, examples: ['Staff Software Engineer, CI']}, {term: 'backend', count: 49, examples: ['Senior Backend Engineer', 'Backend Developer']},
    {term: 'distributed systems', count: 1, examples: []}], ...extra});

test('a narrow search says how little it catches and offers the terms that would add most, with examples on hover', () => {
  const card = coverageCard(verdict());
  assert.equal(card.title, 'Your search may be too narrow');
  assert.match(card.text, /Of 3,142 postings in your places, your role keywords catch 164 \(5%\)/);
  assert.deepEqual(card.chips.map(chip => chip.label), ['+ software engineer · 149', '+ backend · 49', '+ distributed systems · 1']);
  assert.equal(card.chips[1].title, '49 open postings, e.g. Senior Backend Engineer; Backend Developer. About $0.74 once to read and score them.');
  assert.equal(card.chips[2].title, '1 open posting. About $0.02 once to read and score them.');
  assert.deepEqual(card.chips.map(chip => chip.term), ['software engineer', 'backend', 'distributed systems']);   // what addRoles receives
});

test('it stays quiet when the search catches enough, when nothing is worth adding, or after Not now for this crawl', () => {
  assert.equal(coverageCard(null), null);
  assert.equal(coverageCard(verdict({narrow: false})), null);
  assert.equal(coverageCard(verdict({suggestions: []})), null);
  assert.equal(coverageCard(verdict(), '2026-10-02T10:00:00+00:00'), null);       // dismissed for this crawl
  assert.notEqual(coverageCard(verdict(), '2026-09-30T10:00:00+00:00'), null);    // a newer crawl asks again
});

test('a tiny share still reads as at least 1 percent and at most 8 chips are shown', () => {
  const many = Array.from({length: 12}, (_, i) => ({term: `term ${i}`, count: 20 - i, examples: []}));
  const card = coverageCard(verdict({share: 0.001, suggestions: many}));
  assert.match(card.text, /\(1%\)/);
  assert.equal(card.chips.length, 8);
});

import {placesCard} from '../renderer/coverage-card.js';
const places = (extra = {}) => ({at: '2026-10-03T10:00:00+00:00', places: {title_hits: 775, matched: 183, elsewhere: 430,
  options: [{place: 'Ireland', count: 11, examples: ['Senior SRE', 'Platform Engineer'], fragment: '\\bireland\\b|\\bdublin\\b'}, {place: 'Spain', count: 1, examples: []}], ...extra}});

test('the places card says how many matching roles sit outside your places and offers each place with its count', () => {
  const card = placesCard(places());
  assert.equal(card.title, 'Matching roles sit just outside your places');
  assert.match(card.text, /match 775 open roles; 183 are in your places\. 12 more are in these places:/);
  assert.match(card.text, /430 more are in places that need a visa/);
  assert.deepEqual(card.chips.map(chip => chip.label), ['+ Ireland · 11', '+ Spain · 1']);
  assert.deepEqual(card.chips.map(chip => chip.place), ['Ireland', 'Spain']);   // what addPlaces receives
  assert.equal(card.chips[0].title, '11 open roles, e.g. Senior SRE; Platform Engineer. About $0.17 once to read and score them.');
});

test('the places card stays quiet without offers, and after Not now for this crawl', () => {
  assert.equal(placesCard(null), null);
  assert.equal(placesCard({places: null}), null);
  assert.equal(placesCard(places({options: []})), null);
  assert.equal(placesCard(places(), '2026-10-03T10:00:00+00:00'), null);
  assert.notEqual(placesCard(places(), '2026-10-01T10:00:00+00:00'), null);
});

test('when the missed titles are in another language the card says so, and such words can be added', async () => {
  const card = coverageCard(verdict({local: true, suggestions: [{term: 'systemtechniker', count: 6, local: true, examples: ['ICT Systemtechniker 100%']}]}));
  assert.equal(card.title, 'Jobs written in other languages slip past your search');
  assert.match(card.text, /German, French or another language/);
  const {ROLE_TERM} = await import('../lib/strategy.js');
  assert.ok(ROLE_TERM.test('ingénieur système') && ROLE_TERM.test('systemtechniker') && ROLE_TERM.test('amministratore di sistema') && !ROLE_TERM.test('<b>'));
});
