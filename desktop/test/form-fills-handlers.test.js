// Reports → Form fills (lib/form-fills-handlers.js): agent runs through the engine's store, without their conversation.
import assert from 'node:assert/strict';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {formFill, formFills, registerFormFillsHandlers} from '../lib/form-fills-handlers.js';

const here = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('list and get read agent_runs; the transcript stays out (has_transcript says if there is one)', async () => {
  const calls = [];
  const call = async (_s, entity, method, kwargs) => {
    calls.push([entity, method, kwargs]);
    return method === 'list' ? [{id: 'r1', transcript: '[{"role":"user"}]'}] : {id: 'r2', transcript: ''};
  };
  assert.deepEqual(await formFills({}, {call}), [{id: 'r1', has_transcript: true}]);
  assert.deepEqual(await formFill({}, 'r2', {call}), {id: 'r2', has_transcript: false});
  assert.deepEqual(calls, [['agent_runs', 'list', {limit: 200}], ['agent_runs', 'get', {run_id: 'r2'}]]);
  assert.equal(await formFill({}, 'gone', {call: async () => null}), null);
});

test('the IPC: errors are answers and logged; demo reads the fictional fixture', async () => {
  const handlers = {}, lines = [];
  const ipcMain = {handle: (name, fn) => { handlers[name] = fn; }};
  registerFormFillsHandlers({ipcMain, storage: {}, DEMO: false, here, log: (...line) => lines.push(line), call: async () => { throw new Error('no table'); }});
  assert.deepEqual(await handlers.formFills(), {error: 'no table'});
  assert.ok(lines.some(([area, what]) => area === 'reports' && what === 'form fills not read'));
  registerFormFillsHandlers({ipcMain, storage: {}, DEMO: true, here, log: () => {}});
  const {runs} = await handlers.formFills();
  assert.ok(runs.some(run => run.fields.agent === 'Extension') && runs.some(run => run.fields.agent === 'Claude'));
  assert.equal((await handlers.formFill(null, runs[0].id)).run.id, runs[0].id);
});
