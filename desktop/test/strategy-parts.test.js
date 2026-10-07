// The Strategy page's pure parts: role families from the engine's kinds, goal notes instead of red ❓, exclusions split by what they really do,
// suggestion options with openings first, and one chip per company for the manual sites.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {byOpenings, exclusionGroups, goalNote, hostOf, roleFamilies, sitesByName} from '../renderer/strategy-parts.js';

test('roles fall into families in the order listed; an unlabelled role is "Other roles"', () => {
  const families = roleFamilies([{label: 'photographe', kind: 'creative_media'}, {label: 'vendeur', kind: 'sales_retail'},
    {label: 'fotograf', kind: 'creative_media'}, {label: 'odd'}]);
  assert.deepEqual(families.map(family => [family.label, family.entries.map(entry => entry.label)]),
    [['Creative & media', ['photographe', 'fotograf']], ['Retail', ['vendeur']], ['Other roles', ['odd']]]);
});

test('an estimated salary and languages without levels become notes, the value keeps its words', () => {
  assert.deepEqual(goalNote('minimum_salary', 'CHF 48,000 a year (estimate)'), {text: 'CHF 48,000 a year', note: 'estimated'});
  assert.deepEqual(goalNote('languages', 'French (level ❓), Romanian (level ❓), Russian (level ?)'), {text: 'French, Romanian, Russian', note: 'levels'});
  assert.deepEqual(goalNote('languages', 'French (level ❓)'), {text: 'French', note: 'levels'}, 'twice in a row: no regex state left over');
  assert.deepEqual(goalNote('languages', 'French (C1)'), {text: 'French (C1)', note: ''});
  assert.deepEqual(goalNote('seniority', 'Junior (estimate)'), {text: 'Junior (estimate)', note: ''}, 'only the salary is an estimate');
});

test('exclusions: companies, titles and remote regions hide; a language hides when required and ranks lower when nice to have', () => {
  const groups = exclusionGroups({texts: {languages: ['English', 'German']},
    avoid: ['Requires English', 'Requires German', 'Company: Acme', 'Title: senior', 'Remote only from usa']});
  assert.deepEqual(groups.languages, ['English', 'German']);
  assert.deepEqual(groups.hide.map(item => item.label), ['Acme', 'Title: senior', 'Remote only from usa']);
  assert.deepEqual(groups.lower.map(item => item.label), ['English, German only "nice to have"']);
  assert.deepEqual(exclusionGroups({}), {languages: [], hide: [], lower: []});
});

test('options with openings come first, most first; the empty ones go behind Show more', () => {
  const {open, empty} = byOpenings([{term: 'a', count: 0}, {term: 'b', count: 1}, {term: 'c', count: 6}, {term: 'd'}]);
  assert.deepEqual(open.map(option => option.term), ['c', 'b']);
  assert.deepEqual(empty.map(option => option.term), ['a', 'd']);
});

test('a company on two sites is one chip with both pages', () => {
  const sites = sitesByName([{label: 'Open Nestlé', url: 'https://www.nestle-cwa.com/fr/jobs'}, {label: 'Open Rolex', url: 'https://www.rolex.com'},
    {label: 'Open Nestlé', url: 'https://www.corporate.nestle.ca/en/jobs11'}]);
  assert.deepEqual(sites.map(site => [site.name, site.pages.map(page => hostOf(page.url))]),
    [['Nestlé', ['nestle-cwa.com', 'corporate.nestle.ca']], ['Rolex', ['rolex.com']]]);
});
