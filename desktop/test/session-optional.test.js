// The session page's "Optional questions" card (owner, 9 Oct 2026): the form's empty optional fields, folded, never counted as left, never a consent.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {optionalLabels} from '../renderer/optional-questions.js';
import * as review from '../lib/review.js';

const read = path => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('the card lists the empty optional questions, once each, none on a closed tab or an account page, none already needing you', () => {
  const state = {optional: ['LinkedIn profile', 'Salary expectation', 'LinkedIn profile', '']};
  assert.deepEqual(optionalLabels(state), ['LinkedIn profile', 'Salary expectation']);
  assert.deepEqual(optionalLabels(state, {listed: ['Salary expectation']}), ['LinkedIn profile']);
  assert.deepEqual(optionalLabels(state, {gone: true}), []);
  assert.deepEqual(optionalLabels({...state, account: true}), []);
  assert.deepEqual(optionalLabels(undefined), []);
});

test('the panel reports optional empty fields apart from the required ones, never a consent, and offers their proposals', () => {
  const panel = read('extension/review.js');
  assert.match(panel, /optional: state\.list\.filter\(f => !f\.required && !f\.ai && !f\.filled && !\(AGREE\.test\(f\.label\) \|\| f\.category === 'legal'\)\)/);
  assert.match(panel, /proposals: state\.list\.filter\(f => !f\.filled && \(f\.suggested \|\| f\.wants\) && \(f\.required \|\| f\.ai \|\| !\(AGREE\.test\(f\.label\) \|\| f\.category === 'legal'\)\)\)/);
  assert.match(panel, /pending: state\.list\.filter\(f => \(f\.required \|\| f\.ai\) && !f\.filled\)/, 'what is left stays required-only');
});

test('the app keeps the optional list from the report, apart from what is left', () => {
  const sessions = [{id: 's1', url: 'https://jobs.example.test/apply/1', kind: 'form', company: 'Example'}];
  review.report(sessions, {url: 'https://jobs.example.test/apply/1', left: 1, total: 3, pending: ['Email'], optional: ['LinkedIn profile', 7]});
  const state = review.allStates().find(item => item.id === 's1');
  assert.deepEqual(state?.optional, ['LinkedIn profile', '7']);
  assert.deepEqual(state?.pending, ['Email']);
});

test('the session page shows the card after the needs card, and the count never includes it', () => {
  const page = read('desktop/renderer/pages/sessions.js'), needs = read('desktop/renderer/pages/session-needs.js'), html = read('desktop/renderer/index.html');
  assert.match(page, /updateNeedsCount\(\);\n  showOptional\(item, \{gone, listed: empty\}\);/);
  assert.match(needs, /querySelectorAll\('#ss-needs \.ss-need:not\(\.is-done\)'\)/, 'actions remaining counts only #ss-needs');
  assert.ok(html.indexOf('id="ss-optional-card"') > html.indexOf('id="ss-needs-card"'));
});
