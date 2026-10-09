// "Connect Notion" while the data is on this Mac is "Connect and move" (owner, 9 Oct 2026): the prompt's modes (renderer/notion-connect-rules.js),
// and every action that runs off this Mac (lib/notion-gate.js OFF_MAC) reaching that prompt through preload.cjs and running again after the move.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import * as gate from '../lib/notion-gate.js';
import {connectMode, GO_LABEL, moveAfterConnect} from '../renderer/notion-connect-rules.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const onMac = {trying: false, caps: ['local']}, onNotion = {trying: false, caps: ['cloud', 'links']}, trying = {trying: true, caps: []};

test('the prompt: data on this Mac makes the connect a move; on Notion or while trying it is a plain connect', () => {
  assert.equal(connectMode({store: onMac, connected: false}), 'connect-move');
  assert.equal(connectMode({store: onMac, connected: true}), 'move');
  for (const connected of [false, true]) {
    assert.equal(connectMode({store: onNotion, connected}), 'connect');
    assert.equal(connectMode({store: trying, connected}), 'connect');
    assert.equal(connectMode({store: undefined, connected}), 'connect');
  }
  assert.deepEqual(GO_LABEL, {connect: 'Connect with Notion', 'connect-move': 'Connect and move', move: 'Move to Notion'});
});

test('after the connect the move runs only when the data stayed on this Mac (an empty store switched at connect)', () => {
  assert.equal(moveAfterConnect({ok: true, stayedOnMac: true}), true);
  assert.equal(moveAfterConnect({ok: true, stayedOnMac: false, startedOnNotion: true}), false);
  assert.equal(moveAfterConnect({ok: false, stayedOnMac: true}), false);
  assert.equal(moveAfterConnect(null), false);
});

// preload.cjs run with a stand-in Electron: the IPC answers what the gate answers on this Mac's store.
function loadPreload(answer) {
  const events = [], invoked = [];
  let api = null;
  const electron = {contextBridge: {exposeInMainWorld: (_, value) => { api = value; }},
    ipcRenderer: {invoke: async (name, ...args) => { invoked.push([name, ...args]); return answer(name); }, on: () => {}, send: () => {}}};
  const window = {dispatchEvent: event => events.push(event.type)};
  class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } }
  class Event { constructor(type) { this.type = type; } }
  const source = fs.readFileSync(path.join(here, '..', 'preload.cjs'), 'utf8');
  vm.runInNewContext(source, {require: name => (name === 'electron' ? electron : {}), window, CustomEvent, Event, process: {platform: 'darwin', env: {}}, console});
  return {api, events, invoked};
}

test('every action that runs off this Mac asks for the move and runs again after it (the class: lib/notion-gate.js OFF_MAC)', async () => {
  assert.ok(gate.OFF_MAC.size >= 2);
  const storage = {settings: () => ({store: 'sqlite'}), secret: () => 'token'};
  for (const reason of gate.OFF_MAC) {
    const {api, events, invoked} = loadPreload(() => gate.check(storage, reason));
    const action = Object.keys(api).find(name => typeof api[name] === 'function' && !/^(take|retry|on)/.test(name));
    await api[action]('x');
    assert.deepEqual([...events], ['pilot-needs-move'], reason);   // the move's prompt, never the connect's alone
    assert.deepEqual({...api.takeNotionNeed()}, {name: action, reason}, `${reason}: the window knows what to run after the move`);
    await api.retryNotionNeed();
    assert.deepEqual([...invoked.at(-1)], [action, 'x'], `${reason}: the same action runs again`);
  }
});
