// "Is this candidate technical?": the window's rule must be the engine's rule (src/coverage.py looks_technical), row by row of one shared table.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {clearlyTechnical, looksTechnical} from '../renderer/audience.js';

const cases = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'audience_cases.json'), 'utf8')).cases;

test('the window and the engine agree on every case of the shared table', () => {
  for (const {keywords, technical} of cases) assert.equal(looksTechnical(keywords), technical, JSON.stringify(keywords));
});

test('IT-only guidance needs a clearly technical candidate: no roles known is not enough', () => {
  assert.equal(clearlyTechnical([]), false);
  assert.equal(clearlyTechnical(['\\bsre\\b']), true);
  assert.equal(clearlyTechnical(['registered nurse']), false);
});
