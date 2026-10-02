// Jobs list, wide view: a posting that lists many countries made its row hundreds of pixels tall (2 Oct 2026, issue
// #34, found by the nightly layout check — a row was 700 px tall because its "place" column printed job.location in
// full instead of shortening it, so the browser wrapped each "; "-separated country onto its own line). The compact
// list already shortens via placeAndMode -> shortPlace (jobs-view.js); the wide "place" column did not.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const page = fs.readFileSync(new URL('../renderer/pages/jobs.js', import.meta.url), 'utf8');
const placeBlock = page.slice(page.indexOf("const place = el('div', 'place')"), page.indexOf("const status = el('div', 'status-cell')"));

test('the wide list\'s place column shortens a long location list instead of printing it in full', () => {
  assert.doesNotMatch(placeBlock, /el\('span', '', job\.location\)/,
    'job.location must go through shortPlace() before it is shown, or a posting with many countries makes the row hundreds of pixels tall');
  assert.match(placeBlock, /shortPlace\(job\.location\)/, 'the place column should call shortPlace, like the compact list\'s placeAndMode does');
});
