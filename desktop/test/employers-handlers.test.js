// Employers & Sources (lib/employers-handlers.js): every employer through the engine's store, active or not; Active is an upsert by name.
import assert from 'node:assert/strict';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {employers, registerEmployersHandlers, setActive} from '../lib/employers-handlers.js';

const here = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const register = options => {
  const handlers = {}, lines = [];
  registerEmployersHandlers({ipcMain: {handle: (name, fn) => { handlers[name] = fn; }}, storage: {}, here, log: (...line) => lines.push(line), ...options});
  return {handlers, lines};
};

test('the list asks for every employer (active=None) and sorts by name', async () => {
  const calls = [];
  const call = async (_s, entity, method, kwargs) => { calls.push([entity, method, kwargs]); return [{name: 'beta'}, {name: 'Alpha'}]; };
  assert.deepEqual((await employers({}, {call})).map(row => row.name), ['Alpha', 'beta']);
  assert.deepEqual(calls, [['employers', 'list', {active: null}]]);
});

test('Active on/off is employers.upsert({name, active}), the same call Find employers makes', async () => {
  const calls = [];
  const call = async (_s, entity, method, kwargs) => { calls.push([entity, method, kwargs]); return {id: 'e1', ...kwargs.employer}; };
  assert.equal((await setActive({}, 'Acme', false, {call})).active, false);
  assert.deepEqual(calls, [['employers', 'upsert', {employer: {name: 'Acme', active: false}}]]);
  await assert.rejects(setActive({}, ' ', true, {call}), /No employer/);
});

test('the IPC: a store error is an answer, logged; a change is logged with its id, never its name', async () => {
  const {handlers, lines} = register({DEMO: false, call: async (_s, _e, method) => { if (method === 'list') throw new Error('boom'); return {id: 'e9', active: true}; }});
  assert.deepEqual(await handlers.employers(), {error: 'boom'});
  assert.deepEqual(await handlers.employerActive(null, 'Acme', true), {ok: true, employer: {id: 'e9', active: true}});
  assert.ok(lines.some(([area, what]) => area === 'employers' && what === 'list not read'));
  const set = lines.find(([, what]) => what === 'active set');
  assert.deepEqual(set[2], {id: 'e9', active: true, by: 'person'});
});

test('demo mode reads the fictional fixture, every field the page shows', async () => {
  const {handlers} = register({DEMO: true, call: () => { throw new Error('no store in demo'); }});
  const {employers: rows} = await handlers.employers();
  assert.ok(rows.length >= 5);
  assert.ok(rows.some(row => row.kind === 'Job board') && rows.some(row => !row.active));
});
