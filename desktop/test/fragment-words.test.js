// The one "pattern -> words" rule (owner, 17 Oct 2026: "the person never sees a pattern"): every shape the owner's real search settings hold reads as
// plain words, and every screen that shows a crawl list goes through it (the class, not the case).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {fragmentNames, fragmentWords} from '../renderer/fragment-words.js';

// Shapes from a real install's search settings (17 Oct 2026) and the setup AI's examples.
const SHAPES = [
  ['\\bz[uü]rich\\b', ['zürich']], ['"zug"', ['zug']], ['gen[eè]ve', ['genève']], ['st\\.? ?gallen', ['st. gallen']], ['\\bd[uü]bendorf\\b', ['dübendorf']],
  ['deutschland|germany', ['deutschland', 'germany']], ['\\b(?:zug|luzern)\\b', ['zug', 'luzern']], ['site reliability', ['site reliability']], ['\\bsre\\b', ['sre']],
  ['"tax"', ['tax']], ['photograph(e|er)?', ['photograph']], ['vendeu(r|se)', ['vendeur']], ['united states|\\busa?\\b', ['united states', 'usa']], ['\\bst\\. gallen\\b', ['st. gallen']],
];

test('every real pattern shape reads as plain words, no regex syntax and no quotes left', () => {
  for (const [pattern, names] of SHAPES) {
    assert.deepEqual(fragmentNames(pattern), names, pattern);
    for (const name of fragmentNames(pattern)) assert.doesNotMatch(name, /[\\[\]()|?*+^$"]/, `${pattern} -> ${name}`);
  }
  assert.equal(fragmentWords('deutschland|germany'), 'deutschland / germany');
  assert.deepEqual(fragmentNames(''), []);
});

// Every screen or helper that turns a crawl pattern into words uses this one rule (a new copy fails here).
test('the screens and helpers that show crawl patterns all use the one rule', () => {
  const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  for (const file of ['renderer/pages/core.js', 'lib/strategy-rebuild.js', 'lib/locations-move.js', 'renderer/pages/locations-which.js', 'renderer/pages/strategy-review.js'])
    assert.match(read(file), /fragment-words\.js/, file);
  assert.match(read('lib/locations-store.js'), /readSide\(before\[key\]\)\.shown/, 'a set-aside list shows place names');
  const python = fs.readFileSync(new URL('../../src/desktop_strategy.py', import.meta.url), 'utf8');
  assert.match(python, /fragment-words\.js/, 'src/desktop_strategy.py _readable() names the JS rule it mirrors');
});
