// Strategy → Main goals words (owner, 18 Oct 2026, decisions 1 and 2): the salary says its currency and period, or is shown as written with the way to
// pick them; Languages and Work eligibility are Your details' lines exactly as recorded (label and value, nothing inferred); the four tiles in order.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {detailsLine, salaryWords} from '../renderer/strategy-parts.js';

test('Minimum salary: currency and period said; unreadable or missing parts are said too', () => {
  assert.deepEqual(salaryWords('130000 CHF/year gross'), {text: 'CHF 130,000 / year · gross'});
  assert.deepEqual(salaryWords('6000 EUR'), {text: 'EUR 6,000 / ?', note: 'Period not set: Edit to add it'});
  assert.deepEqual(salaryWords('about a lot'), {text: 'about a lot', note: 'As written: Edit to pick its currency and period'});
  assert.deepEqual(salaryWords(''), {text: ''});
});

test('From Your details: each line as recorded, eligibility with its label even alone; nothing when there is nothing', () => {
  assert.equal(detailsLine({languages: [{label: 'English', value: 'Fluent'}, {label: 'German', value: 'B1'}], eligibility: [{label: 'Switzerland', value: 'B permit'}]}),
    'Languages: English: Fluent · German: B1 · Work eligibility: Switzerland: B permit');
  assert.equal(detailsLine({eligibility: [{label: 'Switzerland', value: 'B permit'}]}), 'Work eligibility: Switzerland: B permit', 'the place a permit names stays');
  assert.equal(detailsLine({languages: [{label: 'Languages I can work in', value: 'English (fluent)'}]}), 'Languages: English (fluent)', 'one language line says its value');
  assert.equal(detailsLine({}, 'English, German'), 'Languages: English, German', 'an older Profile line stands in');
  assert.equal(detailsLine({}), '');
});

test('the four tiles in order, Target level among them (not under Advanced), and no editable copy of Your details\' facts', () => {
  const source = fs.readFileSync(new URL('../renderer/pages/main-goals.js', import.meta.url), 'utf8');
  const tiles = [...source.match(/const TILES = \[(.*)\];/)[1].matchAll(/'([^']+)'\]/g)].map(([, label]) => label);
  assert.deepEqual(tiles, ['Target roles', 'Target level', 'Work mode', 'Minimum salary']);
  assert.doesNotMatch(source, /editGoal\(|goalEdits\[('languages'|'eligibility')/, 'Languages and Work eligibility are never edited here');
});
