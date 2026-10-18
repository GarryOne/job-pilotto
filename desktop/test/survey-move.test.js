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

test('a bullet that came back after a rolled-back run is moved again, Undo covers both runs; nothing changed with lines waiting says why', async () => {
  const {storage, page} = await fresh();
  const none = await survey.migrate(storage, {ai: fakeAi([]), copy: async () => ({dir: 'd'})});
  assert.deepEqual(none, {changed: 0, reason: 'no-answer-trusted'});
  assert.deepEqual(await survey.migrate(storage, {ai: {}}), {changed: 0, reason: 'no-ai'});
  storage.saveSettings({surveyMovedAt: undefined});
  await survey.migrate(storage, {ai: fakeAi(said), copy: async () => ({dir: 'd'})});
  const moved = await surveyLines(page);
  const outline = await page.outline(), block = profileParts(outline).surveys.lines.find(line => line.text === moved[0]);
  const {applyEdits} = await import('../lib/text-outline-handlers.js');
  await applyEdits(page, outline, [{op: 'text', id: block.id, value: BULLETS[0]}]);   // a rolled-back write puts the bullet back
  assert.equal((await surveyLines(page))[0], BULLETS[0]);
  const again = await survey.migrate(storage, {ai: fakeAi(said), copy: async () => ({dir: 'd2'})});
  assert.equal(again.changed, 1);
  assert.deepEqual(await surveyLines(page), moved);
  await survey.undo(storage);
  assert.deepEqual(await surveyLines(page), BULLETS);
});

test('an answer the code cannot read is asked again on the next open, three times at most; then the lines stay as written (owner 18 Oct 2026: one bad answer ended the move for good)', async () => {
  const {storage, page} = await fresh();
  const bad = {client: {messages: {create: async () => ({content: [{type: 'text', text: 'not json'}]})}}};
  for (let open = 0; open < 2; open++) assert.equal((await survey.migrate(storage, {ai: bad, copy: async () => ({dir: 'd'})})).reason, 'no-answer-trusted');
  assert.equal(storage.settings().surveyMovedAt, undefined, 'not finished after two unreadable answers');
  const calls = [];
  const good = await survey.migrate(storage, {ai: fakeAi(said, calls), copy: async () => ({dir: 'd'})});
  assert.equal(good.changed, 3, 'the next open moves them');
  assert.match((await surveyLines(page))[0], /pick one/);
  const again = await fresh();
  for (let open = 0; open < 3; open++) await survey.migrate(again.storage, {ai: bad, copy: async () => ({dir: 'd'})});
  assert.ok(again.storage.settings().surveyMovedAt, 'after three tries it stops asking');
});
