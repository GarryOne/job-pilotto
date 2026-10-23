// The Strategy cards write through one seam: window.pilot for the saved strategy, the AI's draft while setup draws the same cards.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';
import {editDraftLists, editDraftText} from '../lib/draft-edit-handlers.js';

install();
const saved = [];
globalThis.window.pilot = {
  editTargets: async edits => { saved.push(['targets', edits]); return {ok: true}; }, editGoal: async (key, value) => { saved.push(['goal', key, value]); return {ok: true}; },
  textOutline: async name => ({ok: true, items: [], store: name}), textEdit: async (name, changes) => { saved.push(['text', name, changes]); return {ok: true}; },
  draftEditLists: async (draft, edits) => ({ok: true, ...editDraftLists(draft, edits)}),
  draftTextOutline: async markdown => ({ok: true, items: [{id: 'L0', text: markdown}]}),
  draftTextEdit: async (markdown, changes) => ({ok: true, ...(await editDraftText(markdown, changes))}),
};
const {sink, useDraft, useSaved, inDraft} = await import('../renderer/strategy-sink.js');

test('saved strategy: every write goes to the store', async () => {
  await sink.editTargets({places: {add: ['brno'], remove: []}});
  await sink.editGoal('work_mode', 'Remote');
  await sink.textEdit('profile', [{op: 'append', lines: ['x']}]);
  assert.deepEqual(saved.map(call => call[0]), ['targets', 'goal', 'text']);
  assert.equal(inDraft(), false);
});

test('draft: the same writes change the draft only, and Target level moves the search level', async () => {
  saved.length = 0;
  const draft = {search: {locations: {top_tier: []}, level: []}, preferences: {}, profile_markdown: '## Goals\n- Work mode: Hybrid\n', goals: {}};
  const kept = [];
  useDraft({get: () => draft, set: fields => { Object.assign(draft, fields); kept.push(Object.keys(fields)); }, setGoal: (key, text) => { draft.goals[key] = text; }, reload() {}});
  await sink.editTargets({places: {add: ['Brno'], remove: []}});
  await sink.editGoal('seniority', 'Senior');
  await sink.textEdit('profile', [{op: 'text', id: 'L1', value: 'Work mode: Remote', was: 'Work mode: Hybrid'}]);
  useSaved();
  assert.deepEqual(draft.search.locations.top_tier, ['brno']);
  assert.deepEqual(draft.search.level, ['senior']);
  assert.equal(draft.goals.seniority, 'Senior');
  assert.match(draft.profile_markdown, /Work mode: Remote/);
  assert.deepEqual(saved, [], 'nothing reached the store');
});
