// A window newer than the running app: every action's rejection reaches the screens as the one plain restart line (preload.cjs), the same words as renderer/errors.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {install} from './tiny-dom.js';

install();
const {OUTDATED_LINE, errorLine, isOutdated} = await import('../renderer/errors.js');

test('every exposed action: "No handler registered" becomes the plain restart line, once announced', async () => {
  let pilot, announced = 0;
  vm.runInNewContext(fs.readFileSync(new URL('../preload.cjs', import.meta.url), 'utf8'), {
    process: {platform: 'darwin'}, Event: class { constructor(type) { this.type = type; } },
    window: {dispatchEvent: event => { if (event.type === 'pilot-outdated') announced++; }},
    require: () => ({contextBridge: {exposeInMainWorld: (_name, api) => { pilot = api; }},
      ipcRenderer: {on() {}, invoke: async name => { throw new Error(`Error invoking remote method '${name}': Error: No handler registered for '${name}'`); }}}),
  });
  const actions = Object.entries(pilot).filter(([, value]) => typeof value === 'function' && !/^(takeNotionNeed|retryNotionNeed|on[A-Z])/.test(value.name || ''));
  let tried = 0;
  for (const [name, call] of actions) {
    let error;
    try { await call(); } catch (caught) { error = caught; }
    if (!error) continue;   // helpers that never invoke (takeNotionNeed and the like)
    tried++;
    assert.equal(error.message, OUTDATED_LINE, `${name}: the screen would show the raw IPC text`);
  }
  assert.ok(tried > 100 && announced === tried, `${tried} actions rejected, ${announced} announced`);
  assert.equal(OUTDATED_LINE, fs.readFileSync(new URL('../preload.cjs', import.meta.url), 'utf8').match(/new Error\('(Jobadabra was updated[^']*)'\)/)[1], 'preload.cjs and errors.js use the same words');
});

test('errorLine: restart line for an outdated app, plain text otherwise (no IPC wrapper)', () => {
  assert.equal(errorLine(new Error("Error invoking remote method 'x': Error: No handler registered for 'x'")), OUTDATED_LINE);
  assert.equal(errorLine(new Error("Error invoking remote method 'x': Error: Notion said no")), 'Notion said no');
  assert.equal(errorLine(null, 'Could not open it.'), 'Could not open it.');
  assert.ok(isOutdated(new Error(OUTDATED_LINE)) && !isOutdated(new Error('other')));
});
