// Employers & Sources (lib/employers-handlers.js): every employer through the engine's store, active or not; Active is an upsert by name.
import assert from 'node:assert/strict';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {employers, fromPage, PASTE_FILE, PASTE_MAX, registerEmployersHandlers, setActive} from '../lib/employers-handlers.js';

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

// Add from a page: the text is kept in the data folder and the scout gets its path; empty text asks for it; demo starts nothing.
test('a pasted page is written to the data folder and the scout checks it', async () => {
  const written = {}, started = [];
  const storage = {writeText: (name, text) => { written[name] = text; }, path: name => `/app/${name}`};
  const {handlers, lines} = register({storage, scoutFromPage: async file => { started.push(file); }});
  assert.deepEqual(await handlers.employersFromPage({}, '  Zauber · Berlin\nZenML  '), {ok: true, chars: 'Zauber · Berlin\nZenML'.length});
  assert.equal(written[PASTE_FILE], 'Zauber · Berlin\nZenML');
  assert.deepEqual(started, ['/app/data/pasted-page.txt']);
  assert.ok(lines.some(line => line[1] === 'page pasted' && !JSON.stringify(line).includes('Zauber')), 'the log never holds the pasted text');
  assert.equal((await handlers.employersFromPage({}, '   ')).ok, false);
  assert.equal(started.length, 1);
  assert.equal(fromPage(storage, 'x'.repeat(PASTE_MAX + 5), async () => {}).chars, PASTE_MAX);
  const demo = register({DEMO: true, scoutFromPage: async () => { throw new Error('demo must not start a scout'); }});
  assert.equal((await demo.handlers.employersFromPage({}, 'Zauber')).demo, true);
});
