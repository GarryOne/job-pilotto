// The screen for "Which locations are right?" (owner, 17 Oct 2026): no side is preselected, every choice the model offers is a button, the advanced one sits
// under Advanced, the card is hidden until a conflict exists, Strategy loads it, and ⌘K lists it only while one is open.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {CHOICES} from '../lib/locations-move.js';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const screen = read('renderer/pages/locations-which.js');

test('every choice has a button, "separate" only under Advanced, and nothing is preselected', () => {
  for (const choice of CHOICES) assert.match(screen, new RegExp(`go\\('${choice}'`), choice);
  assert.match(screen, /add\('Use different locations for searching', go\('separate'\), more\)/);
  assert.doesNotMatch(screen, /autofocus|is-active|primary/);   // no button looks like the recommended one
  assert.match(screen, /Use Profile value/);
  assert.match(screen, /Use Strategy value/);
});

test('the card is hidden until a conflict exists, Strategy loads it, ⌘K lists it only while one is open', () => {
  assert.match(read('renderer/index.html'), /id="strategy-locations-which" hidden/);
  assert.match(read('renderer/pages/strategy.js'), /loadLocationsWhich\(\);/);
  assert.match(read('renderer/pages/nav.js'), /if \(shared\.locationsOpen\) add\('Strategy', 'Which locations are right\?'/);
  assert.match(screen, /card\.hidden = !conflicts\.length/);
});
