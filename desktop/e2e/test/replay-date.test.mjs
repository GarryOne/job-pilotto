// The replay's page clock (lib/replay-date.mjs): the page's Date reads the record's time and flows on; timers are never replaced (a fake setTimeout changed
// Databricks' cookie banner, 14 Oct 2026). Pure: the init script runs in a fresh vm context.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import vm from 'node:vm';
import {dateShiftScript, shiftDate} from '../lib/replay-date.mjs';

test('Date reads the record\'s time and flows on; a date with arguments is untouched; timers are the real ones', async () => {
  const sandbox = {setTimeout, Date};
  vm.createContext(sandbox);
  sandbox.globalThis = sandbox;
  const start = Date.parse('2026-10-13T22:13:30Z'), offset = start - Date.now();
  vm.runInContext(`(${dateShiftScript})(${JSON.stringify({offset})})`, sandbox);
  const first = vm.runInContext('Date.now()', sandbox);
  assert.ok(Math.abs(first - start) < 1000, 'now is the record\'s start');
  assert.ok(Math.abs(vm.runInContext('new Date().getTime()', sandbox) - start) < 1000);
  assert.equal(vm.runInContext('new Date(0).getTime()', sandbox), 0, 'an explicit date is kept');
  assert.equal(vm.runInContext('new Date() instanceof Date', sandbox), true);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.ok(vm.runInContext('Date.now()', sandbox) >= first + 25, 'time flows on');
  assert.equal(sandbox.setTimeout, setTimeout, 'timers are never replaced');
  vm.runInContext(`(${dateShiftScript})(${JSON.stringify({offset: 99999999})})`, sandbox);
  assert.ok(Math.abs(vm.runInContext('Date.now()', sandbox) - start) < 1000, 'a second run (another frame script) does not shift twice');
});

test('shiftDate adds one init script with a fixed offset; replay-net uses it unless asked for fake timers', async () => {
  const added = [];
  const offset = await shiftDate({addInitScript: async (fn, arg) => added.push([fn, arg])}, 5000, 1000);
  assert.equal(offset, 4000);
  assert.deepEqual(added[0][1], {offset: 4000});
  const replay = fs.readFileSync(new URL('../replay-net.mjs', import.meta.url), 'utf8');
  assert.match(replay, /shiftDate\(run\.context, record\.startMs\)/);
  assert.match(replay, /FAKE_TIMERS \? .*clock\.install/);
});
