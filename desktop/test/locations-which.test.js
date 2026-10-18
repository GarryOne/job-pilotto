// The screen for "Which locations are right?" (owner, 17 Oct 2026): no side is preselected, every choice the model offers is a button (18 Oct 2026: the
// shared choice row, no Advanced box), the card is hidden until a conflict exists, Strategy loads it, and ⌘K lists it only while one is open.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {CHOICES} from '../lib/locations-move.js';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const screen = read('renderer/pages/locations-which.js');

test('every choice has a button, no side leads (two equal buttons in their sides\' colours), and the extra one is a quiet link', () => {
  for (const choice of CHOICES) assert.match(screen, new RegExp(`go\\('${choice}'`), choice);
  assert.doesNotMatch(screen, /autofocus|is-active|primary/);   // no button looks like the recommended one (sketch decision 2: "no winner")
  assert.match(screen, /\{label: "Use Strategy's", tone: 'violet', run: go\('strategy'\)\}, \{label: "Use Profile's", tone: 'teal', run: go\('profile'\)\}/);
  assert.match(screen, /label: 'Use different locations for searching', run: \(\) => go\('separate'\)/, 'one quiet Choose… menu holds it');
  assert.match(screen, /choiceRow\(\{/, 'the shared choice row');
  assert.doesNotMatch(screen, /'Advanced'/, 'no empty Advanced box');
});

test('the card is hidden until a conflict exists, Strategy loads it, ⌘K lists it only while one is open', () => {
  assert.match(read('renderer/index.html'), /id="strategy-locations-which" hidden/);
  assert.match(read('renderer/pages/strategy.js'), /loadLocationsWhich\(\);/);
  assert.match(read('renderer/pages/nav.js'), /if \(shared\.locationsOpen\) add\('Strategy', 'Which locations are right\?'/);
  assert.match(screen, /card\.hidden = !conflicts\.length && !aside\.length/);   // set-aside values keep the card (with Undo)
});
