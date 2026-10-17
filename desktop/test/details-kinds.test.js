// Your details' fact lines get their typed control (owner, 17 Oct 2026: "Base facts fixed, AI the rest"; the move runs "on first open, with Undo"; a line it
// can't read with confidence "stays text + Check chip"). The AI judges each label's kind once and may write a line's parts, but the code checks every number
// and word against the original; the pages are copied and backed up first, every original value is checked after, and Undo puts the lines back.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import * as sections from '../lib/profile-sections.js';
import * as store from '../lib/store/index.js';
import * as kinds from '../lib/details-kinds.js';
import {canonical, faithful} from '../renderer/question-values.js';

const fresh = () => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-kinds-')), {encrypt: v => v, decrypt: v => v});
  storage.saveSettings({store: 'sqlite'});
  return storage;
};
const reply = data => ({content: [{type: 'text', text: JSON.stringify(data)}], usage: {}});
// A fake AI: the kind judgment (question-formats) and the line rewrite (details-kinds), told apart by their instructions.
function fakeAi({kindOf = {}, rewrite = {}, calls = []} = {}) {
  return {client: {messages: {create: async request => {
    calls.push(request.system.includes('A job-application form asked') ? 'kinds' : 'rewrite');
    const asked = JSON.parse(request.messages[0].content.replace(/<\/?questions>/g, ''));
    if (request.system.includes('A job-application form asked')) return reply({formats: asked.map(label => ({label, kind: kindOf[label] || 'text', constraints: false, options: [], list: ''}))});
    return reply({items: asked.map(({id}) => ({id, text: rewrite[id] ?? ''}))});
  }}}};
}
const lines = async (storage, key) => (await sections.read(storage))[key];

test('canonical and faithful: the code reads the common wording itself, and a rewrite must keep every number and word', () => {
  assert.equal(canonical('salary', '150000 CHF/year gross'), '150000 CHF/year gross');
  assert.equal(canonical('salary', 'CHF 140,000 a year'), '', 'code cannot read this one');
  assert.equal(canonical('duration', '3 months'), '3 months');
  assert.equal(canonical('range', '50-100'), '50–100 %');
  assert.equal(canonical('link', 'https://github.com/garry'), 'https://github.com/garry');
  assert.equal(faithful('salary', 'CHF 140,000 a year', '140000 CHF/year'), true);
  assert.equal(faithful('salary', 'CHF 140,000 a year', '150000 CHF/year'), false, 'a different number');
  assert.equal(faithful('salary', 'CHF 140,000 a year', '140000 CHF/year, 13 salaries'), false, 'an extra number');
  assert.equal(faithful('duration', '1 month to month-end', '1 month, ends at month-end'), true);
  assert.equal(faithful('per_country', 'Swiss B permit', 'allowed, B permit'), false, 'a status is never the AI\'s to write');
  assert.equal(faithful('language', 'German (B2)', 'B2'), true);
  assert.equal(faithful('language', 'German (B2)', 'C1'), false);
});

test('a section line keeps its kind as a mark on the line, on every store', async () => {
  const storage = fresh();
  await sections.save(storage, 'availability', [{label: 'Notice period', value: '1 month', kind: 'duration'}, {label: 'Start', value: 'any time'}]);
  assert.match(await store.openStore(storage).page('profile').text(), /Notice period: 1 month \[duration\]/);
  assert.deepEqual(await lines(storage, 'availability'), [{label: 'Notice period', value: '1 month', kind: 'duration'}, {label: 'Start', value: 'any time'}]);
});

test('tidy: kind judged once, code and AI write the parts, nothing lost; backup first; an unreadable line stays text with its mark', async () => {
  const storage = fresh();
  await sections.save(storage, 'availability', [{label: 'Notice period', value: '3 months'}, {label: 'Salary expectation', value: 'CHF 140,000 a year'}, {label: 'Mood', value: 'good'}]);
  await sections.save(storage, 'eligibility', [{label: 'Swiss work permit', value: 'Swiss B permit'}]);
  const calls = [], copied = [];
  const ai = fakeAi({calls, kindOf: {'Notice period': 'duration', 'Salary expectation': 'salary', 'Swiss work permit': 'per_country', Mood: 'text'},
    rewrite: {'availability:Salary expectation': '140000 CHF/year', 'eligibility:Swiss work permit': 'allowed, B permit'}});   // the second is refused
  const copy = async () => { copied.push(true); return {dir: 'backup-dir', file: 'backup.zip'}; };
  const result = await kinds.tidy(storage, {ai, copy, now: new Date('2026-10-18T09:00:00Z')});
  assert.equal(copied.length, 1, 'the pages are copied and backed up before any line changes');
  assert.equal(result.changed, 3);
  assert.deepEqual(await lines(storage, 'availability'), [{label: 'Notice period', value: '3 months', kind: 'duration'}, {label: 'Salary expectation', value: '140000 CHF/year', kind: 'salary'}, {label: 'Mood', value: 'good'}]);
  assert.deepEqual(await lines(storage, 'eligibility'), [{label: 'Swiss work permit', value: 'Swiss B permit', kind: 'per_country'}], 'a status is never the AI\'s to write: the words stay, with the mark');
  assert.equal(storage.settings().detailsKindsAt, '2026-10-18T09:00:00.000Z');
  await kinds.tidy(storage, {ai, copy});
  assert.equal(copied.length, 1, 'once: opening Your details again changes nothing');
});

test('a rewrite that changes a number or adds a word is refused: the line keeps its words and gets the mark only', async () => {
  const storage = fresh();
  await sections.save(storage, 'availability', [{label: 'Salary expectation', value: 'CHF 140,000 a year'}]);
  const ai = fakeAi({kindOf: {'Salary expectation': 'salary'}, rewrite: {'availability:Salary expectation': '150000 CHF/year'}});
  await kinds.tidy(storage, {ai, copy: async () => ({dir: 'd'})});
  assert.deepEqual(await lines(storage, 'availability'), [{label: 'Salary expectation', value: 'CHF 140,000 a year', kind: 'salary'}]);
});

test('no AI: nothing changes and the tidy is tried again next time', async () => {
  const storage = fresh();
  await sections.save(storage, 'availability', [{label: 'Notice period', value: '3 months'}]);
  const result = await kinds.tidy(storage, {ai: {}, copy: async () => { throw new Error('no copy without a change'); }});
  assert.equal(result.changed, 0);
  assert.equal(storage.settings().detailsKindsAt, undefined);
});

test('a write that does not read back stops and puts every line back', async () => {
  const storage = fresh();
  await sections.save(storage, 'availability', [{label: 'Notice period', value: '3 months'}]);
  const ai = fakeAi({kindOf: {'Notice period': 'duration'}});
  const save = async () => { throw new Error('Notion is down'); };
  await assert.rejects(() => kinds.tidy(storage, {ai, copy: async () => ({dir: 'd'}), save}), /Notion is down|nothing was removed/);
  assert.deepEqual(await lines(storage, 'availability'), [{label: 'Notice period', value: '3 months'}]);
  assert.equal(storage.settings().detailsKindsAt, undefined);
});

test('Undo puts the lines back as they were', async () => {
  const storage = fresh();
  await sections.save(storage, 'availability', [{label: 'Salary expectation', value: 'CHF 140,000 a year'}]);
  const ai = fakeAi({kindOf: {'Salary expectation': 'salary'}, rewrite: {'availability:Salary expectation': '140000 CHF/year'}});
  await kinds.tidy(storage, {ai, copy: async () => ({dir: 'd'})});
  assert.equal((await lines(storage, 'availability'))[0].value, '140000 CHF/year');
  assert.deepEqual(await kinds.undo(storage), {ok: true});
  assert.deepEqual(await lines(storage, 'availability'), [{label: 'Salary expectation', value: 'CHF 140,000 a year'}]);
  assert.equal(storage.settings().detailsTidy.undone, true);
  assert.equal(storage.settings().detailsKindsAt !== undefined, true, 'undone, and not tidied again');
});

test('the AI may offer per country and language only inside the section that holds them', async () => {
  const storage = fresh();
  await sections.save(storage, 'availability', [{label: 'Work status', value: 'allowed'}]);
  const ai = fakeAi({kindOf: {'Work status': 'per_country'}});
  await kinds.tidy(storage, {ai, copy: async () => ({dir: 'd'})});
  assert.equal((await lines(storage, 'availability'))[0].kind, undefined, 'per country is not an availability kind: the line stays text');
});

test('handlers: opening Your details tidies once and returns each line\'s kind; Save keeps the marks; Undo is a handler', async () => {
  const {registerDetailsFactsHandlers} = await import('../lib/details-facts-handlers.js');
  const storage = fresh();
  storage.saveSettings({profileMovedAt: '2026-10-17T10:00:00Z'});
  await sections.save(storage, 'availability', [{label: 'Notice period', value: '3 months'}]);
  const handlers = {};
  const ai = fakeAi({kindOf: {'Notice period': 'duration'}});
  registerDetailsFactsHandlers({ipcMain: {handle: (name, fn) => { handlers[name] = (...args) => fn(null, ...args); }}, storage, DEMO: false, connected: () => true,
    needsNotion: () => null, log: () => {}, ai: () => ai, copy: async () => ({dir: 'd'})});
  const got = await handlers.detailsFacts();
  assert.deepEqual(got.sections.availability, [{label: 'Notice period', value: '3 months', kind: 'duration'}]);
  assert.equal(got.tidied.changed, 1);
  assert.deepEqual(await handlers.saveDetailsFacts({availability: [{label: 'Notice period', value: '2 months', kind: 'duration'}]}), {ok: true});
  assert.deepEqual(await lines(storage, 'availability'), [{label: 'Notice period', value: '2 months', kind: 'duration'}]);
  assert.deepEqual(await handlers.undoDetailsTidy(), {ok: true});
  assert.equal((await handlers.detailsFacts()).tidied, null, 'undone: the card is gone');
});
