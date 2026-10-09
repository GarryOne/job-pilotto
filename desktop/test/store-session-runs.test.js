// An Apply-with-Claude session's numbers and conversation go to the store (lib/session-runs.js): a Notion Agent Runs row, or on this
// Mac the engine's agent_runs record with the same values in `fields` (parity), or nowhere while trying.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as sessionRuns from '../lib/session-runs.js';
import * as stats from '../lib/session-stats.js';
import {createStorage} from '../lib/storage.js';

const make = (settings, token = '') => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-sr-')), {encrypt: v => v, decrypt: v => v});
  storage.saveSettings(settings);
  if (token) storage.setSecret('NOTION_TOKEN', token);
  return storage;
};
const session = {id: 's1', url: 'https://jobs.example/1', company: 'Acme', title: 'SRE', startedAt: '2026-10-09T10:00:00.000Z', outcome: 'submitted',
  events: [{at: '2026-10-09T10:00:00.000Z', status: 'working'}, {at: '2026-10-09T10:05:00.000Z', status: 'decided'}]};
function fakeEngine() {
  const records = [], calls = [];
  const call = async (_, entity, method, kwargs) => {
    calls.push([entity, method]);
    if (method === 'add') { const made = {id: `a${records.length + 1}`, transcript: '', ...kwargs.run}; records.push(made); return made; }
    if (method === 'update') { const record = records.find(r => r.id === kwargs.run_id); Object.assign(record, kwargs.fields); return record; }
    if (method === 'list') return records;
    throw new Error(method);
  };
  return {call, records, calls};
}

test('this Mac: one agent_runs record, made at the decision, with the same numbers as the Notion columns', async () => {
  const storage = make({store: 'sqlite'}, 'leftover-token');
  const {call, records} = fakeEngine();
  assert.equal(await sessionRuns.write(session, sessionRuns.optionsFor(storage, {call})), null);   // not decided yet: nothing made
  const id = await sessionRuns.write(session, sessionRuns.optionsFor(storage, {create: true, call}));
  assert.equal(id, 'a1');
  const {outcome: plainOutcome, ...plain} = stats.plain(session);
  assert.deepEqual(records[0].fields, plain);
  assert.equal(plainOutcome, 'Submitted');
  assert.equal(records[0].outcome, 'Submitted');
  const columns = stats.properties(session);
  assert.equal(columns.Outcome.select.name, plainOutcome);
  assert.equal(columns['Times asked'].number, plain.times_asked);
  await sessionRuns.write({...session, runPage: id, outcome: 'cancelled'}, sessionRuns.optionsFor(storage, {call}));
  assert.equal(records.length, 1);
  assert.equal(records[0].outcome, 'Cancelled');
});

test('this Mac: the conversation is kept on the record and read back', async () => {
  const storage = make({store: 'sqlite'});
  const {call} = fakeEngine();
  const id = await sessionRuns.write(session, sessionRuns.optionsFor(storage, {create: true, call}));
  const talk = [{role: 'user', text: 'Apply'}, {role: 'assistant', text: 'Done'}];
  assert.equal(await sessionRuns.saveConversation(storage, {...session, runPage: id}, talk, {call}), 2);
  assert.deepEqual(await sessionRuns.loadConversation(storage, id, {call}), talk);
});

test('Notion is the store: a Notion row as before; trying: nowhere', () => {
  const notion = sessionRuns.optionsFor(make({notionIds: {NOTION_PROFILE_PAGE_ID: 'p', NOTION_AGENT_RUNS_DB: 'runs'}}, 't'));
  assert.equal(notion.db, 'runs');
  assert.equal(typeof notion.call, 'function');
  assert.equal(notion.agentRuns, undefined);
  assert.deepEqual(sessionRuns.optionsFor(make({})), {});
});
