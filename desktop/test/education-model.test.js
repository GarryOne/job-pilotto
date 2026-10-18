// Education as entries (renderer/education-model.js, owner decision 3, 18 Oct 2026): only the app's own "Degree · School · Years" shape is read as fields;
// any other line stays as written; opening and saving with no change writes nothing; a line organized into fields with nothing typed keeps its words.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {changesFor} from '../renderer/experience-profile-model.js';
import {entriesOf, fieldsOf, lineOf, textsOf} from '../renderer/education-model.js';

const part = (...texts) => ({headingId: 'h', lines: texts.map((text, i) => ({id: `l${i}`, text})), rows: [], hints: []});
const DEMO = part('MSc Computer Science, Example Technical University', '(confirmed 2 Oct 2026; graduation year to confirm if a form asks)', '**BSc Physics** · Example College · 2010 – 2013');

test('a legacy line is never guessed apart or put whole into Degree; the app\'s shape is fields', () => {
  assert.equal(fieldsOf('MSc Computer Science, Example Technical University'), null);
  assert.equal(fieldsOf('MSc'), null);
  assert.equal(fieldsOf('A · B · C · D'), null, 'more than three parts: kept as written');
  assert.deepEqual(fieldsOf('**BSc Physics** · Example College · 2010 – 2013'), {degree: 'BSc Physics', school: 'Example College', years: '2010 – 2013'});
  assert.deepEqual(fieldsOf('PhD · Example University'), {degree: 'PhD', school: 'Example University', years: ''});
  const entries = entriesOf(DEMO);
  assert.deepEqual(entries.map(entry => [entry.index, Boolean(entry.fields)]), [[0, false], [2, true]], 'the note is not an entry');
});

test('fields → line: incomplete and ongoing years allowed; a line written reads back as the same fields', () => {
  for (const fields of [{degree: 'MSc', school: 'ETH', years: '2024 – ongoing'}, {degree: 'MSc', school: 'ETH', years: ''}, {degree: 'MSc', school: '', years: ''},
    {degree: '', school: 'ETH', years: '2019'}, {degree: 'MSc', school: '', years: '2019'}]) {
    assert.deepEqual(fieldsOf(lineOf(fields)), fields, lineOf(fields));
  }
  assert.equal(lineOf({degree: '', school: '', years: ''}), '');
});

test('open and save with no change: no change at all', () => {
  const drafts = entriesOf(DEMO).map(entry => ({index: entry.index, text: entry.text, fields: entry.fields && {...entry.fields}}));
  assert.deepEqual(changesFor('education', DEMO, textsOf(DEMO, drafts)), []);
});

test('organize a legacy line: nothing typed keeps its words; typed fields replace it; remove and add', () => {
  const organized = [{index: 0, text: DEMO.lines[0].text, fields: {degree: '', school: '', years: ''}}];
  assert.deepEqual(changesFor('education', DEMO, textsOf(DEMO, organized)), [], 'organize, then type nothing: kept');
  organized[0].fields = {degree: 'MSc Computer Science', school: 'Example Technical University', years: ''};
  assert.deepEqual(changesFor('education', DEMO, textsOf(DEMO, organized)),
    [{op: 'text', id: 'l0', value: 'MSc Computer Science · Example Technical University', was: DEMO.lines[0].text}]);
  const changes = changesFor('education', DEMO, textsOf(DEMO, [{index: 2, removed: true}, {index: null, fields: {degree: 'CKA', school: 'CNCF', years: '2024'}}]));
  assert.deepEqual(changes, [{op: 'remove', id: 'l2', was: DEMO.lines[2].text}, {op: 'insert', after: 'l1', lines: ['CKA · CNCF · 2024']}]);
  assert.equal(changesFor('education', DEMO, textsOf(DEMO, [{index: null, fields: {degree: '', school: '', years: ''}}])).length, 0, 'an empty new entry adds nothing');
});

test('an unstructured line edited as words keeps its edit; a Profile with no Education gets the section', () => {
  assert.deepEqual(changesFor('education', DEMO, textsOf(DEMO, [{index: 0, text: 'MSc Computer Science, Example Technical University, 2016'}])).map(change => change.value),
    ['MSc Computer Science, Example Technical University, 2016']);
  assert.deepEqual(changesFor('education', null, textsOf(null, [{index: null, fields: {degree: 'MSc', school: 'ETH', years: '2014 – 2016'}}])),
    [{op: 'section', heading: 'Education', lines: ['MSc · ETH · 2014 – 2016']}]);
});
