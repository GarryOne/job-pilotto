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

// A Your details page shaped like a real one (fictional values): language rows with marks, a long note under nearly every answer, scoring
// instructions inside a note, per-country questions answered "Yes — …" / "No, …", a question that names no place, and a nationality line.
const NOTE = '(note: Not eligible without sponsorship, confirmed 2 Sep 2026. Scoring: show a sponsorship badge and do not lower the location score; when a form asks, answer "No".)';
const NOISY = {
  languages: [{label: 'English', value: 'C1 [language]'}, {label: 'Portuguese', value: 'native [language]'}, {label: 'Polish', value: 'A2 [language]'},
    {label: 'Languages I can work in (note)', value: '(working language) · No Dutch, Danish or Czech.'}],
  eligibility: [{label: 'Irish work permit', value: `Stamp 4; EU citizen (Portugal) ${NOTE} [per country]`},
    {label: 'Authorised to work in Ireland?', value: 'Yes — Stamp 4, EU citizen (Portugal). No sponsorship needed. [per country]'},
    {label: 'Authorised to work in Spain / EU?', value: 'Yes — EU citizen. [per country]'},
    {label: 'Authorised to work in the UK?', value: `No, I will require visa sponsorship ${NOTE} [per country]`},
    {label: 'Authorised to work in the US?', value: `No, I will require visa sponsorship ${NOTE} [per country]`},
    {label: 'Authorised to work in Canada?', value: `No, I will require visa sponsorship ${NOTE} [per country]`},
    {label: 'Authorised to work in the UAE (Abu Dhabi)?', value: `No, I will require visa sponsorship ${NOTE} [per country]`},
    {label: 'Remote from Ireland for a foreign employer?', value: `Yes ${NOTE} [per country]`},
    {label: 'Will you now or in the future require visa sponsorship?', value: `Yes for UK, US, Canada roles; No for Ireland ${NOTE}`},
    {label: 'Please indicate your nationality', value: 'Portuguese'}],
};

test('From Your details: one short line of languages with levels and where the person may work; never notes, marks or instructions', () => {
  const line = detailsLine(NOISY);
  assert.equal(line, 'Languages: English C1 · Portuguese native · Polish A2 · Works in: Ireland, Spain / EU · Needs sponsorship: UK, US, Canada, UAE');
  assert.ok(line.length <= 160, `short: ${line.length} characters`);
  assert.doesNotMatch(line, /note|Scoring|confirmed|\[|\]|nationality|Portuguese$|answer/i, 'no notes, no marks, no instructions');
});

test('From Your details: the answers as recorded, nothing wider; the forms the controls write read the same', () => {
  assert.equal(detailsLine({eligibility: [{label: 'Switzerland', value: 'allowed, B permit [per country]'}, {label: 'United States', value: 'needs visa [per country]'}]}),
    'Works in: Switzerland · Needs sponsorship: United States');
  assert.equal(detailsLine({eligibility: [{label: 'Switzerland', value: 'B permit'}]}), '', 'no allowed / needs visa / Yes / No answer: left to Your details');
  const many = ['France', 'Italy', 'Austria', 'Belgium', 'Norway', 'Sweden'].map(place => ({label: place, value: 'needs visa [per country]'}));
  assert.equal(detailsLine({eligibility: many}), 'Needs sponsorship: France, Italy, Austria, Belgium +2 more', 'a long list folds');
  assert.equal(detailsLine({}, 'English, German'), 'Languages: English, German', 'an older Profile line stands in');
  assert.equal(detailsLine({}, `English (fluent), German (B1) ${NOTE}`), 'Languages: English (fluent), German (B1)', 'without its note');
  assert.equal(detailsLine({}), '');
});

test('the four tiles in order, Target level among them (not under Advanced), and no editable copy of Your details\' facts', () => {
  const source = fs.readFileSync(new URL('../renderer/pages/main-goals.js', import.meta.url), 'utf8');
  const tiles = [...source.match(/const TILES = \[(.*)\];/)[1].matchAll(/'([^']+)'\]/g)].map(([, label]) => label);
  assert.deepEqual(tiles, ['Target roles', 'Target level', 'Work mode', 'Minimum salary']);
  assert.doesNotMatch(source, /editGoal\(|goalEdits\[('languages'|'eligibility')/, 'Languages and Work eligibility are never edited here');
});
