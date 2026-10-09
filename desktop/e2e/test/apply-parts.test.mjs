// The apply suite's parts and fixtures stay consistent: every journey step runs where its fixture's kit is seeded, and the wrong-kind page
// has a page shape no other fixture shares (both broke the 9 Oct 2026 beta: a step in the wrong part, a shape remembered from another page).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import * as forms from '../lib/forms.mjs';
import {partOf} from '../suites/apply.mjs';
import {appCode} from '../lib/account-eval.mjs';

const journeySteps = () => [...fs.readFileSync(new URL('../lib/apply-journeys.mjs', import.meta.url), 'utf8').matchAll(/ctx\.run\('((?:[^'\\]|\\.)*)'/g)]
  .map(match => match[1].replace(/\\'/g, "'"));

test('every journey step is a flows step, where its fixture jobs and kits are seeded', () => {
  const steps = journeySteps();
  assert.ok(steps.length >= 10, `only ${steps.length} journey steps read: the pattern no longer matches`);
  assert.deepEqual(steps.filter(name => partOf(name) !== 'flows'), []);
});

test('the wrong-kind page has its own page shape: no other fixture page shares its kind cache', async () => {
  await appCode();
  const {pageShape} = await import('../../lib/page-kind.js');
  const {MISLABELLED} = forms;
  assert.equal(pageShape(MISLABELLED.url), MISLABELLED.shape);
  const pages = Object.values(forms).flatMap(item => (item && typeof item === 'object' && !Array.isArray(item) ? [item, ...Object.values(item)] : []))
    .filter(item => item && item !== MISLABELLED && typeof item.host === 'string' && typeof item.path === 'string')
    .flatMap(item => [item.path, item.accountPath, item.formPath].filter(Boolean).map(path => `https://${item.path === path ? item.host : item.accountHost || item.host}${path}`));
  assert.ok(pages.length >= 10, `only ${pages.length} fixture pages found`);
  assert.deepEqual(pages.filter(url => pageShape(url) === MISLABELLED.shape), []);
});
