// The CV gaps paragraph becomes one line per gap on first open, with Undo (owner, 17 Oct 2026, M7): the AI splits it, the code checks every gap and word is in the paragraph
// and no number is lost; the pages are copied and backed up first; a write that fails puts the paragraph back.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import * as store from '../lib/store/index.js';
import * as gaps from '../lib/gaps-move.js';
import {profileParts} from '../renderer/experience-profile-model.js';

const PARAGRAPH = 'Prometheus, Go, Argo CD, PagerDuty (5 years). Please confirm or discard each.';
const fresh = async (text = PARAGRAPH) => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-gaps-')), {encrypt: v => v, decrypt: v => v});
  storage.saveSettings({store: 'sqlite'});
  const page = store.openStore(storage).page('profile');
  await page.insertAfter(await page.appendHeading('❓ Possible CV gaps'), [text, 'Another line stays.']);
  return {storage, page};
};
const linesOf = async page => (profileParts(await page.outline()).gaps?.lines || []).map(line => line.text);
const ai = (items, calls = []) => ({client: {messages: {create: async request => { calls.push(request); return {content: [{type: 'text', text: JSON.stringify({items: typeof items === 'function' ? items(JSON.parse(request.messages[0].content)) : items})}]}; }}}});
const said = [{id: '0', gaps: ['Prometheus', 'Go', 'Argo CD', 'PagerDuty (5 years)'], note: 'Please confirm or discard each.'}, {id: '1', gaps: [], note: ''}];

test('the paragraph becomes one line per gap, to check, with its note kept; backup first; once only', async () => {
  const {storage, page} = await fresh();
  const copied = [];
  const result = await gaps.migrate(storage, {ai: ai(said), copy: async () => { copied.push(1); return {dir: 'd'}; }});
  assert.equal(copied.length, 1);
  assert.equal(result.changed, 1);
  assert.deepEqual(await linesOf(page), ['Prometheus (CV gap: to check)', 'Go (CV gap: to check)', 'Argo CD (CV gap: to check)', 'PagerDuty (5 years) (CV gap: to check)', 'Please confirm or discard each.', 'Another line stays.']);
  assert.equal((await gaps.migrate(storage, {ai: ai(said), copy: async () => { throw new Error('once'); }})).changed, 0);
});

test('a split the code cannot trust is refused: a gap that is not in the paragraph, a lost number, a note that is not in it', async () => {
  for (const bad of [{gaps: ['Prometheus', 'Terraform'], note: ''}, {gaps: ['Prometheus', 'Go', 'Argo CD', 'PagerDuty'], note: 'Please confirm or discard each.'}, {gaps: ['Prometheus', 'Go', 'Argo CD', 'PagerDuty (5 years)'], note: 'made up'}]) {
    const {storage, page} = await fresh();
    await gaps.migrate(storage, {ai: ai([{id: '0', ...bad}]), copy: async () => ({dir: 'd'})});
    assert.deepEqual(await linesOf(page), [PARAGRAPH, 'Another line stays.']);
  }
});

test('no AI: nothing changes and it is tried again; Undo puts the paragraph back', async () => {
  const {storage, page} = await fresh();
  assert.equal((await gaps.migrate(storage, {ai: {}, copy: async () => { throw new Error('no copy'); }})).changed, 0);
  assert.equal(storage.settings().gapsMovedAt, undefined);
  await gaps.migrate(storage, {ai: ai(said), copy: async () => ({dir: 'd'})});
  assert.deepEqual(await gaps.undo(storage), {ok: true});
  assert.deepEqual(await linesOf(page), [PARAGRAPH, 'Another line stays.']);
  assert.deepEqual(await gaps.undo(storage), {ok: false, error: 'There is nothing to undo'});
});
