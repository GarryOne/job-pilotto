// Strategy's skip and finder words in two groups, never a raw quote or pattern on a chip; Google Jobs places in words (renderer/match-groups.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {asWholeWord, isWholeWord, matchGroups, placeLabel, shownWord} from '../renderer/match-groups.js';
import {isRawValue} from '../renderer/chip-text.js';
import {cleanEdits} from '../lib/strategy.js';

test('"word" and \\bword\\b match the whole word; anything else anywhere', () => {
  assert.equal(isWholeWord('"intern"'), true);
  assert.equal(isWholeWord('\\bsre\\b'), true);
  assert.equal(isWholeWord('stage'), false);
  assert.equal(isWholeWord('z[uü]rich'), false);
  const groups = matchGroups([{fragment: 'stage', label: 'stage'}, {fragment: '"intern"', label: 'intern'}, {fragment: '', label: '"lead"', added: true},
    {fragment: '', label: 'junior', added: true}]);
  assert.deepEqual(groups.anywhere.map(entry => entry.label), ['stage', 'junior']);
  assert.deepEqual(groups.whole.map(entry => shownWord(entry.label)), ['intern', 'lead']);
});

test('a chip never shows the quotes or the pattern', () => {
  for (const label of ['"intern"', '"lead"', 'intern']) assert.equal(isRawValue(shownWord(label)), false, label);
  assert.equal(asWholeWord('  lead '), '"lead"');
  assert.equal(asWholeWord('"lead"'), '"lead"');
});

test('a whole-word add is stored as \\bword\\b, escaped; a plain add stays anywhere', () => {
  assert.deepEqual(cleanEdits({titleSkip: {add: ['"Lead"', 'stage', '"c++"', '""']}}), {titleSkip: {add: ['\\blead\\b', 'stage', '\\bc\\+\\+\\b'], remove: []}});
  assert.equal(isWholeWord(cleanEdits({finders: {add: [asWholeWord('ops')]}}).finders.add[0]), true);
});

test('a Google Jobs place reads as words', () => {
  assert.equal(placeLabel('Zurich,Zurich,Switzerland · de'), 'Zurich, Switzerland · German');
  assert.equal(placeLabel('Geneva,Switzerland · fr'), 'Geneva, Switzerland · French');
  assert.equal(placeLabel('London'), 'London');
  assert.equal(placeLabel('Lausanne · français'), 'Lausanne · français');
});
