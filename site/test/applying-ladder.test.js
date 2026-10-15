// The AI ladder card (src/applying-ladder.js) cannot go stale: its data is generated from the rung files, and this fails when the data file is out of date, a listed file is gone or a new rung* file is unlisted.
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {test} from 'node:test';
import {FILL_FILES, RUNGS, build, listedFiles, render, rungFilesOnDisk} from '../scripts/gen-ladder-data.mjs';
import {LADDER_DATA} from '../src/applying-ladder-data.js';
import {PAGE} from '../src/applying.js';

const root = new URL('../../', import.meta.url);

test('the generated ladder data matches the code (run node site/scripts/gen-ladder-data.mjs when this fails)', () => {
  assert.deepEqual(LADDER_DATA, build());
  assert.equal(readFileSync(new URL('../src/applying-ladder-data.js', import.meta.url), 'utf8'), render());
});

test('every file the ladder lists exists, and every rung* file on disk is listed', () => {
  for (const file of listedFiles()) assert.ok(existsSync(new URL(file, root)), file + ' is listed but missing');
  const listed = listedFiles();
  for (const file of rungFilesOnDisk()) assert.ok(listed.has(file), file + ' is a rung file the ladder card does not list: add it to RUNGS in site/scripts/gen-ladder-data.mjs');
  assert.ok(FILL_FILES.length >= 3 && RUNGS.length === 7);
});

test('models come from the code: rung 4 names its model and price, rungs 2 and 3 their tier; the card shows them, cheapest rung at the bottom, always open', () => {
  const by = Object.fromEntries(LADDER_DATA.rungs.map(rung => [rung.n, rung]));
  assert.equal(by[4].model, 'claude-opus-5-5'); assert.ok(by[4].price?.input > 0);
  assert.ok(by[2].model && by[3].model);
  assert.equal(by[0].kind, 'free'); assert.equal(by[6].kind, 'person');
  assert.ok(PAGE.includes('flex-direction:column-reverse'), 'rung 0 is drawn at the bottom');
  assert.doesNotMatch(PAGE.slice(PAGE.indexOf('The AI ladder'), PAGE.indexOf('const MEANS = ')), /'details'/);
});
