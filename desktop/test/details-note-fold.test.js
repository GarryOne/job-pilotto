// A long Your details line keeps its fact as the value and its rules as a folded "Note for the AI" (owner, 18 Oct 2026: "Apply your 'Folded Note for the AI'
// decision there too"). The owner's shapes, values fictional: a ~700-character Work eligibility line (permit + rules for applying and scoring) and an
// Availability "Target" line whose rule ("Treat as a target…") sat in the value. The AI splits once; the code checks every word is copied, none lost.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {install} from './tiny-dom.js';
import {createStorage} from '../lib/storage.js';
import * as sections from '../lib/profile-sections.js';
import * as kinds from '../lib/details-kinds.js';
import * as notes from '../lib/details-notes.js';

install();
const {factRow, factOf} = await import('../renderer/fact-line.js');
const fresh = () => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-fold-')), {encrypt: v => v, decrypt: v => v});
  storage.saveSettings({store: 'sqlite'});
  return storage;
};
const reply = data => ({content: [{type: 'text', text: JSON.stringify(data)}], usage: {}});
const PERMIT = 'C permit; EU citizen (Portugal) — no sponsorship needed in Switzerland or the EU.';
const RULES = 'He wants to keep applying to roles that say "no sponsorship" in the UK and the US, because a transfer can still work out. ' +
  'Scoring: the digest shows a red visa badge on those jobs, but they must not be dropped from the list; mention the permit in the first line of a cover letter. ' +
  'For a yes/no "Do you need sponsorship?" field: answer No for Switzerland and the EU, Yes for the UK and the US, and never guess for another country.';
const ELIGIBILITY = `${PERMIT} ${RULES}`;
const TARGET_VALUE = '~CHF 9,500 net per month.';
const TARGET_NOTE = 'Treat as a target, not a posted field. Store advertised gross separately; any net estimate is an approximate scenario.';
const TARGET = `${TARGET_VALUE} ${TARGET_NOTE}`;

// The AI as it should answer: the fact copied as the value, the rest copied as the note; a short line is never sent.
function ai(answer = {}, calls = []) {
  return {client: {messages: {create: async request => {
    const items = JSON.parse(request.messages[0].content);
    calls.push(items.map(item => item.id));
    return reply({items: items.map(({id}) => ({id, value: answer[id]?.[0] ?? '', note: answer[id]?.[1] ?? ''}))});
  }}}};
}
const GOOD = {'eligibility:Swiss work permit': [PERMIT, RULES], 'availability:Target': [TARGET_VALUE, TARGET_NOTE]};
const seed = async storage => {
  await sections.save(storage, 'eligibility', [{label: 'Swiss work permit', value: ELIGIBILITY}, {label: 'Nationality', value: 'Portuguese'}]);
  await sections.save(storage, 'availability', [{label: 'Target', value: TARGET}, {label: 'Notice period', value: '3 months', kind: 'duration'}]);
};

test('split: the fact stays the value, the rules become its note, once; short lines are not sent', async () => {
  const storage = fresh(), calls = [];
  await seed(storage);
  const done = await notes.split(storage, {ai: ai(GOOD, calls), copy: async () => ({dir: 'd'})});
  assert.equal(done.changed, 2);
  assert.deepEqual(calls, [['eligibility:Swiss work permit', 'availability:Target']], 'only the long lines go to the AI');
  const found = await sections.read(storage);
  assert.deepEqual(found.eligibility, [{label: 'Swiss work permit', value: PERMIT, note: RULES}, {label: 'Nationality', value: 'Portuguese'}]);
  assert.deepEqual(found.availability, [{label: 'Target', value: TARGET_VALUE, note: TARGET_NOTE}, {label: 'Notice period', value: '3 months', kind: 'duration'}]);
  assert.equal((await notes.split(storage, {ai: ai(GOOD, calls)})).changed, 0);
  assert.equal(calls.length, 1, 'it runs once per install');
});

test('a split that changes, adds or drops a word is refused: the line keeps its words', () => {
  assert.equal(notes.faithfulSplit(TARGET, TARGET_VALUE, TARGET_NOTE), true);
  assert.equal(notes.faithfulSplit(TARGET, '~CHF 9,500 net per month.', 'Treat as a target, not a posted field.'), false, 'a sentence dropped');
  assert.equal(notes.faithfulSplit(TARGET, '~CHF 10,000 net per month.', TARGET_NOTE), false, 'a number changed');
  assert.equal(notes.faithfulSplit(TARGET, 'About CHF 9,500 net per month.', TARGET_NOTE), false, 'a word reworded');
  assert.equal(notes.faithfulSplit(TARGET, TARGET, ''), false, 'nothing set apart');
  assert.equal(notes.faithfulSplit(TARGET, '', TARGET), false, 'no value left');
});

test('nothing changes without the AI, and it is tried again later', async () => {
  const storage = fresh();
  await seed(storage);
  assert.equal((await notes.split(storage, {})).changed, 0);
  assert.equal(storage.settings().detailsNotesAt, undefined);
});

test('Undo gives back the long lines as they were, with the kinds tidy before it', async () => {
  const storage = fresh();
  await seed(storage);
  storage.saveSettings({detailsKindsAt: '2026-10-17T00:00:00Z'});
  await notes.split(storage, {ai: ai(GOOD), copy: async () => ({dir: 'd'})});
  assert.equal(storage.settings().detailsTidy.changed, 2);
  await kinds.undo(storage);
  const back = await sections.read(storage);
  assert.equal(back.eligibility[0].value, ELIGIBILITY);
  assert.equal(back.availability[0].value, TARGET);
});

test('every Your details line with a note folds it as "Note for the AI" in a box that grows, and gives it back', () => {
  for (const line of [{label: 'Target', value: '9500 CHF/month net', kind: 'salary', note: TARGET_NOTE}, {label: 'Swiss work permit', value: PERMIT, note: RULES},
    {label: 'Switzerland', value: 'allowed, C permit', kind: 'per_country', note: 'Confirmed 2 Oct.'}, {label: 'English', value: 'B2', kind: 'language', note: 'Working language.'}]) {
    const row = factRow(line.label === 'English' ? 'languages' : 'availability', line, {}, () => {});
    const fold = row.all().find(node => node.tagName === 'DETAILS');
    assert.ok(fold && fold.className.includes('qa-note-fold'), `${line.label}: the note is folded`);
    assert.ok(!fold.open, 'closed until asked');
    assert.equal(fold.all().find(node => node.tagName === 'SUMMARY').textContent, 'Note for the AI');
    const box = fold.all().find(node => node.dataset.factNote);
    assert.equal(box.tagName, 'TEXTAREA', 'a note is never cut by a one-line box');
    assert.equal(factOf(row).note, line.note);
  }
  const plain = factRow('availability', {label: 'Mood', value: 'good'}, {}, () => {});
  assert.equal(plain.all().some(node => node.tagName === 'DETAILS'), false, 'no fold without a note');
});

test('a long text value is a box that grows, never cut by a one-line field', () => {
  const row = factRow('eligibility', {label: 'Swiss work permit', value: ELIGIBILITY}, {}, () => {});
  const value = row.all().find(node => node.dataset.factValue);
  assert.equal(value.tagName, 'TEXTAREA');
  assert.equal(factOf(row).value, ELIGIBILITY);
  const short = factRow('eligibility', {label: 'Nationality', value: 'Portuguese'}, {}, () => {});
  assert.equal(short.all().find(node => node.dataset.factValue).tagName, 'INPUT');
});

test('handlers: opening Your details splits the long lines after the kinds tidy, and the Tidied card counts them', async () => {
  const {registerDetailsFactsHandlers} = await import('../lib/details-facts-handlers.js');
  const storage = fresh();
  storage.saveSettings({profileMovedAt: '2026-10-17T10:00:00Z'});
  await seed(storage);
  const split = ai(GOOD), text = {client: {messages: {create: async request => {
    if (!request.system.includes('A job-application form asked')) return split.client.messages.create(request);
    const asked = JSON.parse(request.messages[0].content.replace(/<\/?questions>/g, ''));
    return reply({formats: asked.map(label => ({label, kind: 'text', constraints: false, options: [], list: ''}))});
  }}}};
  const handlers = {};
  registerDetailsFactsHandlers({ipcMain: {handle: (name, fn) => { handlers[name] = (...args) => fn(null, ...args); }}, storage, DEMO: false, connected: () => true,
    needsNotion: () => null, log: () => {}, ai: () => text, copy: async () => ({dir: 'd'})});
  const got = await handlers.detailsFacts();
  assert.equal(got.ok, true, got.error);
  assert.deepEqual(got.sections.eligibility[0], {label: 'Swiss work permit', value: PERMIT, note: RULES});
  assert.equal(got.tidied.changed, 2);
});
