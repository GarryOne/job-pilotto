// The Profile text as form data and back (renderer/profile-model.js): nothing the person wrote is lost, a changed value lands in its row,
// and what the form does not know stays as text. Uses the app's own template (docs/notion-profile-template.md).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {kindOf, needsAnswer, normalized, parseProfile, serializeProfile} from '../renderer/profile-model.js';

const TEMPLATE = fs.readFileSync(new URL('../../docs/notion-profile-template.md', import.meta.url), 'utf8').split('## 👤 Profile — CV and Preferences')[1].split('\n---')[0];
const PAGE = `## 👤 Profile — CV and Preferences

# Hard constraints

| Constraint | Value |
|---|---|
| Countries | Switzerland nationwide; remote within Europe |
| Home base | Geneva; ❓ willingness to relocate |
| Work mode | On-site, hybrid or remote |
| My own row | keep, with a | pipe |

# Compensation

Gross, per year.
- Target: CHF 150k
- Minimum acceptable: CHF 130k

# My weird section

Keep me, with **bold** and a | pipe.

# Summary (from CV)

SRE with AWS.
`;
const words = text => text.replace(/[|\s#*-]+/g, ' ').trim().split(' ');

test('the sections the form knows are found by the words their heading starts with', () => {
  assert.equal(kindOf('Hard constraints'), 'constraints');
  assert.equal(kindOf('Compensation (gross)'), 'pay');
  assert.equal(kindOf('Preferences (soft, used for ranking)'), 'preferences');
  assert.equal(kindOf('Summary (from CV)'), null);
});

test('a page is split into rows and values, notes, and the rest, and written back whole', () => {
  const model = parseProfile(PAGE);
  assert.deepEqual(model.sections.map(s => s.kind), ['constraints', 'pay']);
  assert.deepEqual(model.sections[0].rows.map(r => r[0]), ['Countries', 'Home base', 'Work mode', 'My own row']);
  assert.deepEqual(model.sections[1].bullets, [{label: 'Target', value: 'CHF 150k'}, {label: 'Minimum acceptable', value: 'CHF 130k'}]);
  assert.equal(model.sections[1].notes, 'Gross, per year.');
  assert.match(model.rest, /^# My weird section/);
  assert.match(model.rest, /# Summary \(from CV\)/);
  const written = serializeProfile(model);
  for (const word of words(PAGE).filter(w => w !== '|')) assert.ok(written.includes(word), `kept: ${word}`);
  assert.equal(normalized(written), written, 'writing is stable: a second round trip changes nothing');
});

test('an edited value lands in its row; a pipe typed in a value cannot break the table; unanswered rows are noticed', () => {
  const model = parseProfile(PAGE);
  model.sections[0].rows[0][1] = 'Switzerland | EU';
  model.sections[1].bullets[0].value = 'CHF 160k';
  const written = serializeProfile(model);
  assert.match(written, /\| Countries \| Switzerland \/ EU \|/);
  assert.match(written, /- Target: CHF 160k/);
  assert.match(written, /Keep me, with \*\*bold\*\* and a \| pipe\./, 'text outside the form is untouched');
  assert.ok(needsAnswer(model.sections[0].rows[1][1]));
  assert.ok(!needsAnswer(model.sections[0].rows[0][1]));
});

test('the app\'s own template survives: every word of it, its rows and sections', () => {
  const model = parseProfile(TEMPLATE);
  assert.deepEqual(model.sections.map(s => s.kind), ['constraints', 'pay', 'preferences']);
  assert.ok(model.sections[0].rows.length >= 10);
  const written = serializeProfile(model);
  for (const word of words(TEMPLATE)) assert.ok(written.includes(word), `kept: ${word}`);
  assert.match(written, /# Education/);
  assert.equal(parseProfile('').sections.length, 0);
  assert.equal(serializeProfile(parseProfile('just my own words')).trim(), 'just my own words');
});
