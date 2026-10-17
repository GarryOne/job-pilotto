// The voluntary survey bullets become fixed questions with fixed lists on first open (owner, 17 Oct 2026, decision B): the AI maps each bullet to a question and a
// choice, the code keeps the owner's words (a note is copied from the bullet), refuses a mapping that changes a number or picks twice, backs up first, and Undo restores.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import * as store from '../lib/store/index.js';
import * as survey from '../lib/survey-move.js';
import {profileParts} from '../renderer/experience-profile-model.js';

const BULLETS = ['Gender identity: Male (or Man if that is the option label)', 'Race / ethnicity: White', 'Veteran status: I am not a veteran', 'In the past ten years, how many companies have you worked for?: 4',
  'Use these answers for equivalent questions on any form.'];
const fresh = async () => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-survey-')), {encrypt: v => v, decrypt: v => v});
  storage.saveSettings({store: 'sqlite'});
  const page = store.openStore(storage).page('profile');
  await page.insertAfter(await page.appendHeading('Application form answers — voluntary demographic surveys'), BULLETS);
  return {storage, page};
};
const surveyLines = async page => (profileParts(await page.outline()).surveys?.lines || []).map(line => line.text);
const reply = items => ({content: [{type: 'text', text: JSON.stringify({items})}]});
const fakeAi = (items, calls = []) => ({client: {messages: {create: async request => { calls.push(request); return reply(typeof items === 'function' ? items(JSON.parse(request.messages[0].content)) : items); }}}});
const said = [
  {id: '0', kind: 'answer', question: 'gender', option: 'Man', note: 'or Man if that is the option label'},
  {id: '1', kind: 'answer', question: 'ethnicity', option: 'White', note: ''},
  {id: '2', kind: 'answer', question: 'veteran', option: 'No', note: 'I am not a veteran'},
  {id: '3', kind: 'keep', question: '', option: '', note: ''},
  {id: '4', kind: 'notes', question: '', option: '', note: ''}];

test('bullets become marked answers, a bullet that is no survey question stays, instructions become Notes for the AI; backup first', async () => {
  const {storage, page} = await fresh();
  const copied = [];
  const result = await survey.migrate(storage, {ai: fakeAi(said), copy: async () => { copied.push(1); return {dir: 'd'}; }});
  assert.equal(copied.length, 1);
  assert.equal(result.changed, 3, 'an answer already in the app\'s own words is left alone');
  const lines = await surveyLines(page);
  assert.match(lines[0], /^Gender identity: Man \(note: or Man if that is the option label\) \[pick one: Man \| Woman \| Non-binary \| Decline to self-identify\]$/);
  assert.equal(lines[1], BULLETS[1]);
  assert.match(lines[2], /^Veteran status: No \(note: I am not a veteran\) \[pick one: Yes \| No \| Decline/);
  assert.equal(lines[3], BULLETS[3], 'not a survey question: kept as written');
  assert.equal(lines[4], `Notes for the AI: ${BULLETS[4]}`);
  const again = await survey.migrate(storage, {ai: fakeAi(said), copy: async () => { throw new Error('once'); }});
  assert.equal(again.changed, 0);
});

test('a mapping the code cannot trust is refused: a note that is not in the bullet, a number changed, a choice outside the list, one question twice', async () => {
  const {storage, page} = await fresh();
  await survey.migrate(storage, {copy: async () => ({dir: 'd'}), ai: fakeAi([
    {id: '0', kind: 'answer', question: 'gender', option: 'Man', note: 'invented words'},
    {id: '1', kind: 'answer', question: 'ethnicity', option: 'Caucasian', note: ''},
    {id: '2', kind: 'answer', question: 'veteran', option: 'No', note: ''},
    {id: '3', kind: 'answer', question: 'age', option: '30–39', note: ''},
    {id: '4', kind: 'answer', question: 'veteran', option: 'Yes', note: ''}])});
  const lines = await surveyLines(page);
  assert.equal(lines[0], BULLETS[0]);
  assert.equal(lines[1], BULLETS[1]);
  assert.equal(lines[2], BULLETS[2], 'the same question twice: neither is trusted');
  assert.equal(lines[3], BULLETS[3], 'a number the bullet does not hold');
  assert.equal(lines[4], BULLETS[4]);
});

test('no AI: nothing changes and it is tried again; a write that fails puts every line back; Undo restores', async () => {
  const {storage, page} = await fresh();
  assert.equal((await survey.migrate(storage, {ai: {}, copy: async () => { throw new Error('no copy'); }})).changed, 0);
  assert.equal(storage.settings().surveyMovedAt, undefined);
  await survey.migrate(storage, {ai: fakeAi(said), copy: async () => ({dir: 'd'})});
  assert.notEqual((await surveyLines(page))[0], BULLETS[0]);
  assert.deepEqual(await survey.undo(storage), {ok: true});
  assert.deepEqual(await surveyLines(page), BULLETS);
  assert.deepEqual(await survey.undo(storage), {ok: false, error: 'There is nothing to undo'});
});
