// The owner's own shapes (17 Oct 2026: "The instruction-like prose ('Treat as a target…', 'Confirmed 26 Sep') goes into a note under the control, not into the value"):
// a salary line with a remark, "Minimum GBP 120,000/year. Confirmed 26 Sep 2026.", a notice line with a rule, one Languages line listing three languages. Values are
// fictional but shaped like his. The AI splits a value from its note; the code keeps every number once and copies the note word for word.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {install} from './tiny-dom.js';
import {createStorage} from '../lib/storage.js';
import * as sections from '../lib/profile-sections.js';
import * as kinds from '../lib/details-kinds.js';
import {faithful} from '../renderer/question-values.js';

install();
const {factRow, factOf} = await import('../renderer/fact-line.js');
const fresh = () => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-notes-')), {encrypt: v => v, decrypt: v => v});
  storage.saveSettings({store: 'sqlite'});
  return storage;
};
const reply = data => ({content: [{type: 'text', text: JSON.stringify(data)}], usage: {}});
const LINES = {
  target: '~CHF 10,000 net per month. Treat as a target, not a posted field.',
  uk: 'Minimum GBP 120,000/year. Confirmed 26 Sep 2026.',
  remote: "No separate remote rate; use the minimum for the employer's own country.",
  notice: "1 month's notice, ending at month-end. For a start-date field, give a concrete date.",
  languages: 'English B2 (working language), Romanian native, Russian B1. No French, German or Italian.',
};
// The AI as it should answer: each value in the kind's wording, the rest copied into the note.
function ai(calls = []) {
  return {client: {messages: {create: async request => {
    const sys = request.system;
    if (sys.includes('A job-application form asked')) {
      const asked = JSON.parse(request.messages[0].content.replace(/<\/?questions>/g, ''));
      const kind = {Target: 'salary', 'Salary expectation, UK': 'salary', 'Salary expectation, remote': 'salary', 'Notice period': 'duration', 'Languages I can work in': 'text'};
      return reply({formats: asked.map(label => ({label, kind: kind[label] || 'text', constraints: false, options: [], list: ''}))});
    }
    if (sys.includes('may list the languages')) {
      calls.push('languages');
      return reply({items: JSON.parse(request.messages[0].content).map(({id}) => ({id, languages: [{name: 'English', level: 'B2'}, {name: 'Romanian', level: 'native'}, {name: 'Russian', level: 'B1'}], note: 'No French, German or Italian.'}))});
    }
    calls.push('rewrite');
    const rewrite = {'availability:Target': ['10000 CHF/month net', 'Treat as a target, not a posted field.'], 'availability:Salary expectation, UK': ['120000 GBP/year', 'Minimum · Confirmed 26 Sep 2026.'],
      'availability:Notice period': ['1 month, ends at month-end', 'For a start-date field, give a concrete date.']};
    return reply({items: JSON.parse(request.messages[0].content).map(({id}) => ({id, text: rewrite[id]?.[0] ?? '', note: rewrite[id]?.[1] ?? ''}))});
  }}}};
}

test('a line keeps its note on every store: the value, then (note: …), then the mark', async () => {
  const storage = fresh();
  await sections.save(storage, 'availability', [{label: 'Target', value: '10000 CHF/month net', kind: 'salary', note: 'Treat as a target (not posted).'}]);
  assert.deepEqual((await sections.read(storage)).availability, [{label: 'Target', value: '10000 CHF/month net', note: 'Treat as a target (not posted).', kind: 'salary'}]);
});

test('faithful with a note: every number once, note copied word for word', () => {
  assert.equal(faithful('salary', LINES.uk, '120000 GBP/year', 'Minimum · Confirmed 26 Sep 2026.'), true);
  assert.equal(faithful('salary', LINES.uk, '120000 GBP/year', ''), false, 'the date\'s numbers would be lost');
  assert.equal(faithful('salary', LINES.uk, '120000 GBP/year', 'Confirmed 27 Sep 2026.'), false, 'a note that is not in the line');
  assert.equal(faithful('salary', LINES.uk, '130000 GBP/year', 'Minimum · Confirmed 26 Sep 2026.'), false);
  assert.equal(faithful('salary', LINES.target, '10000 CHF/month net', 'Treat as a target, not a posted field.'), true);
  assert.equal(faithful('duration', LINES.notice, '1 month, ends at month-end', 'For a start-date field, give a concrete date.'), true);
});

test('tidy: his shapes land in typed controls, the prose goes to the note, nothing is lost', async () => {
  const storage = fresh();
  await sections.save(storage, 'availability', [{label: 'Target', value: LINES.target}, {label: 'Salary expectation, UK', value: LINES.uk}, {label: 'Salary expectation, remote', value: LINES.remote}, {label: 'Notice period', value: LINES.notice}]);
  await sections.save(storage, 'languages', [{label: 'Languages I can work in', value: LINES.languages}]);
  const calls = [];
  await kinds.tidy(storage, {ai: ai(calls), copy: async () => ({dir: 'd'})});
  const found = await sections.read(storage);
  assert.deepEqual(found.availability, [
    {label: 'Target', value: '10000 CHF/month net', note: 'Treat as a target, not a posted field.', kind: 'salary'},
    {label: 'Salary expectation, UK', value: '120000 GBP/year', note: 'Minimum · Confirmed 26 Sep 2026.', kind: 'salary'},
    {label: 'Salary expectation, remote', value: LINES.remote},
    {label: 'Notice period', value: '1 month, ends at month-end', note: 'For a start-date field, give a concrete date.', kind: 'duration'}]);
  assert.deepEqual(found.languages, [
    {label: 'English', value: 'B2', kind: 'language'}, {label: 'Romanian', value: 'native', kind: 'language'}, {label: 'Russian', value: 'B1', kind: 'language'},
    {label: 'Languages I can work in (note)', value: 'No French, German or Italian.'}]);
  // Undo gives back his words.
  await kinds.undo(storage);
  const back = await sections.read(storage);
  assert.equal(back.languages[0].value, LINES.languages);
  assert.equal(back.availability[1].value, LINES.uk);
});

test('a language split that invents a language, a level or a number is refused', async () => {
  const bad = (languages, note = '') => ({client: {messages: {create: async () => reply({items: [{id: 'a', languages, note}]})}}});
  const run = reply => kinds.expandLanguages([{id: 'a', text: LINES.languages}], reply);
  assert.equal((await run(bad([{name: 'English', level: 'B2'}, {name: 'Romanian', level: 'native'}, {name: 'Russian', level: 'B1'}], 'No French, German or Italian.'))).size, 1);
  assert.equal((await run(bad([{name: 'English', level: 'C1'}, {name: 'Romanian', level: 'native'}, {name: 'Russian', level: 'B1'}], 'No French, German or Italian.'))).size, 0, 'a level the line never said');
  assert.equal((await run(bad([{name: 'English', level: 'B2'}, {name: 'Romanian', level: 'native'}, {name: 'Russian', level: 'B1'}, {name: 'Polish', level: 'A2'}]))).size, 0, 'a language the line never named');
  assert.equal((await run(bad([{name: 'English', level: 'B2'}, {name: 'Romanian', level: 'native'}, {name: 'Russian', level: 'B1'}], 'No Spanish.'))).size, 0, 'a note that is not in the line');
});

test('the line control shows a note under it, gives it back, and a language line draws level chips', () => {
  const row = factRow('availability', {label: 'Target', value: '10000 CHF/month net', kind: 'salary', note: 'Treat as a target.'}, {}, () => {});
  assert.deepEqual(factOf(row), {label: 'Target', value: '10000 CHF/month net', kind: 'salary', note: 'Treat as a target.'});
  const language = factRow('languages', {label: 'English', value: 'B2', kind: 'language'}, {}, () => {});
  const chips = language.all().filter(node => node.tagName === 'BUTTON').map(node => node.textContent);
  assert.deepEqual(chips, ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'native']);
  assert.equal(factOf(language).value, 'B2');
  const fresh_ = factRow('languages', {}, {}, () => {});
  assert.equal(factOf(fresh_).kind, 'language', 'a new line in Languages is a language');
});
