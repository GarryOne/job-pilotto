// Guards lib/ready-auto.js: tonight's list goes to the server by itself when it changes and before the Mac goes off, never twice, never late.
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createAutoSend, startAutoSend} from '../lib/ready-auto.js';

const evening = () => new Date(2026, 9, 18, 18, 40);   // before tonight's 02:00 fill
const storageOf = (ready = {}) => {
  let saved = {ready};
  return {settings: () => saved, saveSettings: patch => { saved = {...saved, ...patch}; }};
};
const setup = ({codes = ['a', 'b'], eligible = true, now = evening, ready, sendNow} = {}) => {
  const storage = storageOf(ready), sends = [];
  let list = codes;
  const auto = createAutoSend({storage, eligible: () => eligible, tonightCodes: () => list, now,
    sendNow: sendNow || (async () => { sends.push([...list]); return {ok: true, queued: list.length}; })});
  return {storage, sends, auto, setList: next => { list = next; }};
};

test('sends when tonight\'s list changes, and only then', async () => {
  const {auto, sends, setList, storage} = setup();
  await auto.check('start');
  await auto.check('again');
  assert.equal(sends.length, 1, 'an unchanged list is not sent twice');
  assert.equal(storage.settings().ready.sent.count, 2);
  setList(['b', 'a']);
  await auto.check('same jobs, other order');
  assert.equal(sends.length, 1);
  setList(['a', 'b', 'c']);
  await auto.check('a job got its kit');
  assert.equal(sends.length, 2);
  assert.equal(storage.settings().ready.sent.count, 3);
});

test('never sends: not the owner\'s app, after the fill time, a night already started, nothing finished', async () => {
  const cases = {
    'not eligible': setup({eligible: false}),
    'after 02:00': setup({now: () => new Date(2026, 9, 19, 3, 0)}),
    'Fill now ran': setup({ready: {ranNight: '2026-10-19'}}),
    'no finished job': setup({codes: []}),
  };
  for (const [name, {auto, sends}] of Object.entries(cases)) {
    const result = await auto.check(name);
    assert.ok(result.skipped, name);
    assert.equal(sends.length, 0, name);
  }
});

test('a send by hand is recorded: the next check does not send it again', async () => {
  const {auto, sends} = setup();
  auto.record(['b', 'a'], {ok: true, queued: 2}, evening());
  assert.equal((await auto.check('after Fill tonight')).skipped, 'up to date');
  assert.equal(sends.length, 0);
});

test('a failed send is not recorded, so the next check tries again; a throw never escapes', async () => {
  let calls = 0;
  const {auto, storage} = setup({sendNow: async () => { calls++; if (calls === 1) return {ok: false, error: 'offline'}; if (calls === 2) throw new Error('boom'); return {ok: true, queued: 2}; }});
  await auto.check('1');
  assert.equal(storage.settings().ready.sent, undefined);
  assert.equal((await auto.check('2')).ok, false);
  await auto.check('3');
  assert.equal(calls, 3);
  assert.equal(storage.settings().ready.sent.count, 2);
});

test('one send at a time: checks during a send join it', async () => {
  let release;
  const {auto} = setup({sendNow: () => new Promise(resolve => { release = () => resolve({ok: true, queued: 2}); })});
  const first = auto.check('timer'), second = auto.check('screen locked');
  assert.equal(first, second);
  await new Promise(resolve => setImmediate(resolve));
  release();
  await first;
});

test('startAutoSend: nothing starts without Electron; quit waits for the last send, then quits once', async () => {
  assert.equal(typeof startAutoSend(() => {}, {}), 'function');
  const app = new EventEmitter(), powerMonitor = new EventEmitter(), checks = [];
  let quits = 0;
  app.quit = () => { quits++; app.emit('before-quit', {defaultPrevented: false, preventDefault() {}}); };
  const stop = startAutoSend(why => { checks.push(why); return Promise.resolve(); }, {app, powerMonitor, every: 1e9, quitWait: 50});
  powerMonitor.emit('lock-screen');
  powerMonitor.emit('suspend');
  const asked = {defaultPrevented: true, preventDefault() {}};
  app.emit('before-quit', asked);   // the app's own "quit?" dialog held it: not our turn yet
  assert.deepEqual(checks, ['screen locked', 'the Mac sleeps']);
  let prevented = false;
  app.emit('before-quit', {defaultPrevented: false, preventDefault() { prevented = true; }});
  assert.ok(prevented, 'the quit waits for the last send');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(quits, 1);
  assert.deepEqual(checks.slice(2), ['the app quits'], 'the second quit goes through without another send');
  stop();
});

test('startAutoSend: a send that hangs never blocks the quit past its limit', async () => {
  const app = new EventEmitter(), powerMonitor = new EventEmitter();
  let quits = 0;
  app.quit = () => { quits++; };
  const stop = startAutoSend(() => new Promise(() => {}), {app, powerMonitor, every: 1e9, quitWait: 20});
  powerMonitor.emit('shutdown', {preventDefault() {}});
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(quits, 1);
  stop();
});
