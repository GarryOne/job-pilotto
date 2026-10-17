// Strategy's chips as read (owner, 17 Oct 2026: "One chip per meaning", "Did you mean…" flags, screenshot 1183): one chip per meaning in its first
// entry's place, a Google Jobs place read as a place, and every chip list the AI reads drawn through the meanings and the typo lines (the class).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {ANYWHERE, MEANING_LISTS, WHOLE_WORD, matchGroups, meaningLabels, placeText} from '../renderer/chip-meanings.js';
import {LISTS} from '../lib/list-meanings.js';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('the entries of one meaning become one chip, where the first of them stood; the rest stay as they are', () => {
  const groups = [{main: 'United States', others: ['USA', 'US']}];
  assert.deepEqual(meaningLabels(groups, ['USA', 'Canada', 'United States', 'US', 'Mexico']), [groups[0], 'Canada', 'Mexico']);
  assert.deepEqual(meaningLabels([], ['a', 'b']), ['a', 'b']);
  assert.deepEqual(meaningLabels(undefined, ['a']), ['a'], 'no answer yet: as stored');
});

test('a Google Jobs place reads as a place: parts once each, the language by its name', () => {
  assert.equal(placeText('Zurich,Zurich,Switzerland · de'), 'Zurich, Switzerland · German');
  assert.equal(placeText('Geneva,Geneva,Switzerland · fr'), 'Geneva, Switzerland · French');
  assert.equal(placeText('Remote'), 'Remote');
  assert.equal(placeText('Basel,Basel-Stadt,Switzerland · xx-unknown-code'), 'Basel, Basel-Stadt, Switzerland · xx-unknown-code');
});

test('a list with whole-word entries and match-anywhere entries shows two named groups; one kind shows one unnamed group', () => {
  const entries = [{fragment: '"tax"', label: 'tax'}, {fragment: 'legal', label: 'legal'}, {fragment: '\\bUS\\b', label: 'US'}, {fragment: 'USA', label: 'USA'}];
  const shown = ['tax', 'legal', {main: 'US', others: ['USA']}];
  assert.deepEqual(matchGroups(entries, shown), [{title: ANYWHERE, labels: ['legal']}, {title: WHOLE_WORD, labels: ['tax', shown[2]]}]);
  assert.deepEqual(matchGroups(entries.slice(1, 2), ['legal']), [{title: '', labels: ['legal']}]);
  assert.deepEqual(matchGroups(entries.slice(0, 1), ['tax']), [{title: '', labels: ['tax']}]);
});

test('the AI reads the same lists the page draws through the meanings', () => {
  assert.deepEqual(MEANING_LISTS, LISTS);
});

test('every list the AI reads is drawn one chip per meaning with its "Did you mean" lines (the class)', () => {
  const page = read('renderer/pages/strategy-targets.js');
  const views = page.slice(page.indexOf('const VIEWS = {'), page.indexOf('// Your goals:'));
  for (const name of MEANING_LISTS) {
    const drawn = views.includes(`withHints('${name}', `) || new RegExp(`row\\('[^']+', '[^']+', '${name}'`).test(views);
    assert.ok(drawn, `${name}: drawn without the meanings`);
  }
  assert.match(views, /withHints\(name, draw\)/, 'the search card rows go through withHints');
  assert.match(page, /matchGroups\(entriesOf\(strategyState\.lastStrategy, name\), shownOf\(name\)\)/, 'withHints draws one chip per meaning, in groups');
  assert.doesNotMatch(views, /chipsOf\((places|regions|rights|stack)\)/, 'a list drawn from its raw labels');
  assert.match(page, /if \(!editing && strategyState\.lastStrategy\) loadMeanings\(labelsOf, renderTargets\)/, 'asked when read, never while editing');
});
