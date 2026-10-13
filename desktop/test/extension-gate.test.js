// Apply with no Chrome extension: every way to open a Chrome form is stopped with {needsExtension} and the window explains the install.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {check} from '../lib/extension-gate.js';
import {registerApplyHandlers} from '../lib/apply-handlers.js';
import * as terminals from '../lib/terminals.js';
import {registerSessionHandlers} from '../lib/session-handlers.js';

const here = path.resolve(import.meta.dirname, '..');
const gate = (copies, seen = null) => check({find: () => copies, seen: () => seen, folder: '/x'});

test('no copy in any browser, never seen: blocked as absent', () => {
  const result = gate([]);
  assert.equal(result.ok, false); assert.equal(result.needsExtension, true); assert.equal(result.state, 'absent');
  assert.match(result.error, /Chrome extension/);
});
test('a copy turned off: blocked as off; an enabled copy or a report: let through', () => {
  assert.equal(gate([{enabled: false}]).state, 'off');
  assert.equal(gate([{enabled: true}]), null);
  assert.equal(gate([], {at: 1}), null);
});
test('a failed read of the profiles never blocks', () => {
  assert.equal(check({find: () => { throw new Error('no profile'); }, seen: () => null}), null);
});

test('the class: Apply, batch Apply and Start again each answer the gate and open nothing', async () => {
  const handles = new Map(), opened = [];
  const blocked = {ok: false, needsExtension: true, state: 'absent'};
  const ipcMain = {handle: (name, fn) => handles.set(name, fn)};
  registerApplyHandlers({DEMO: false, extensionGate: () => blocked, allowanceBlock: () => null, needsNotion: () => null, claudeConsent: async () => true,
    ipcMain, log: () => {}, here, storage: {}, toWindow: () => {}, track: () => {}, shell: {}, prepareKitFor: async () => ({}), startClaude: () => ({}), getRecipeReporter: () => null, cloud: {}});
  terminals._reset();
  terminals.usePty(async () => ({spawn: () => ({onData: () => {}, onExit: () => {}, write: () => {}, resize: () => {}, kill: () => {}})}));
  registerSessionHandlers({ipcMain, appLog: () => {}, storage: {}, getWindow: () => null, here, DEMO: false, extensionGate: () => blocked, nativeImage: {createFromPath: () => ({})},
    dialog: {showMessageBox: async () => ({response: 0})}, review: {forget: () => {}}, pipeline: {}, server: {}, notion: {}, claudeConsent: async () => true,
    apply: {openOne: () => { opened.push('open'); return {ok: true}; }, applyOne: async () => { opened.push('chrome'); return {ok: true}; }, claudeOne: async () => ({ok: true})}});
  const {id} = terminals.startForm({id: 's1', url: 'https://jobs.example.test/a', company: 'Acme'});
  assert.deepEqual(await handles.get('applyOne')({}, 'https://jobs.example.test/a', {}), blocked);
  assert.deepEqual(await handles.get('apply')({}, {n: 1, mode: 'chrome'}), blocked);
  assert.deepEqual(await handles.get('sessionRestart')({}, id), blocked);
  assert.deepEqual(opened, []);
});

test('the window: preload raises the event and the dialog and its wiring exist', () => {
  assert.match(fs.readFileSync(path.join(here, 'preload.cjs'), 'utf8'), /needsExtension[\s\S]{0,200}pilot-needs-extension/);
  const html = fs.readFileSync(path.join(here, 'renderer/index.html'), 'utf8');
  for (const id of ['extension-needed-dialog', 'extension-needed-title', 'extension-needed-go', 'extension-needed-later']) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(fs.readFileSync(path.join(here, 'renderer/app.js'), 'utf8'), /extensionNeeded\(\)/);
});
