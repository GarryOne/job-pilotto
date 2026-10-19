// Every Strategy card's read view draws through readRows (owner, 19 Oct 2026: "these 2 cards with chips look good, the other 4 look randomly arranged"):
// no intro sentence glued to chips, no lone caption between chip rows, no second row helper. The class: a new card, or a card edited later, fails here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const src = read('renderer/pages/strategy-targets.js');
const views = src.slice(src.indexOf('const VIEWS = {'), src.indexOf('const reloadTargets'));
const keys = [...src.matchAll(/^  \['(\w+)', '\w+', '[^']+', \[\[/gm)].map(match => match[1]);

test('every target card has a read view, and each one is built from readRows alone', () => {
  assert.deepEqual(keys.sort(), ['languages', 'places', 'queries', 'search', 'stack']);
  for (const key of keys) {
    const start = views.search(new RegExp(`^  ${key}\\(\\) \\{`, 'm'));
    assert.ok(start >= 0, `${key} has a read view`);
    const rest = views.slice(start + 1), end = rest.search(/^  \w+\(\) \{/m), body = rest.slice(0, end < 0 ? undefined : end);
    assert.match(body, /readRows\(/, `${key} draws its rows with readRows`);
    assert.match(body, /\{lined: true\}/, `${key} has the divider between rows`);
    assert.doesNotMatch(body, /el\('p', 'sub'/, `${key}: no sentence between chip rows; a lead goes in the header, a note in the row`);
  }
});

test('no old row helper is left, and the lead lines sit in the card header', () => {
  assert.doesNotMatch(src, /function settingRow|settingRow\(/);
  for (const key of ['queries', 'stack', 'languages']) assert.match(src, new RegExp(`LEADS = \\{[^}]*\\b${key}:`), `${key} has its lead in the header`);
});

test('Job preferences uses readRows too (Main goals is tiles, mockup 03)', () => {
  for (const file of ['renderer/pages/job-preferences.js']) assert.match(read(file), /readRows\(/, file);
});
