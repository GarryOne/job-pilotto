// lib/office-addon.js: the LibreOffice add-on in the app: one download at a time, each step sent to the window, Cancel, a failure said
// (never thrown at the person), and a LibreOffice already there counts as ready.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {officeAddon} from '../lib/office-addon.js';

const storage = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-office-addon-')); return {path: name => path.join(root, name)}; };
const sent = () => { const events = []; return {events, toWindow: (channel, event) => events.push([channel, event.step])}; };

test('a Word CV starts one download; a second start waits for it; each step reaches the window', async () => {
  const {events, toWindow} = sent();
  let calls = 0, done = false;
  const install = async (dir, {onProgress}) => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 5));
    for (const step of ['download', 'check', 'unpack']) onProgress({step});
    done = true;
    return path.join(dir, 'soffice');
  };
  const addon = officeAddon(storage(), {toWindow, install, find: () => (done ? '/x/soffice' : null)});
  const [a, b] = [addon.start(), addon.start()];
  assert.equal(a, b, 'the second start gets the running one');
  assert.match(await a, /soffice$/);
  assert.equal(calls, 1);
  assert.deepEqual(events.map(e => e[1]), ['download', 'download', 'check', 'unpack', 'ready']);
  assert.ok(events.every(e => e[0] === 'officeProgress'));
  assert.deepEqual(addon.state(), {step: 'ready'});
});

test('LibreOffice already there: ready at once, nothing downloaded', async () => {
  const addon = officeAddon(storage(), {install: () => assert.fail('no download'), find: () => '/Applications/LibreOffice.app/Contents/MacOS/soffice'});
  assert.equal(await addon.start(), '/Applications/LibreOffice.app/Contents/MacOS/soffice');
  assert.deepEqual(addon.state(), {step: 'ready'});
});

test('Cancel stops the download and says cancelled; a failure says why; both resolve null', async () => {
  const {events, toWindow} = sent();
  const install = (dir, {signal}) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  const addon = officeAddon(storage(), {toWindow, install, find: () => null});
  const run = addon.start();
  addon.cancel();
  assert.equal(await run, null);
  assert.equal(addon.state().step, 'cancelled');
  const failing = officeAddon(storage(), {toWindow, install: async () => { throw new Error('LibreOffice could not be downloaded (HTTP 503).'); }, find: () => null});
  assert.equal(await failing.start(), null);
  assert.deepEqual(failing.state(), {step: 'failed', error: 'LibreOffice could not be downloaded (HTTP 503).'});
  assert.deepEqual(events.map(e => e[1]), ['download', 'cancelled', 'download', 'failed']);
});
