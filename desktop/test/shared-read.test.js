// lib/shared-read.js: overlapping reads share one run; a finished or failed one doesn't stick.
import test from 'node:test';
import assert from 'node:assert/strict';
import {afterWrite, readsChanged, sharedRead} from '../lib/shared-read.js';
import {mainSource} from './main-source.js';

const later = () => { let done; const promise = new Promise(resolve => { done = resolve; }); return {promise, done}; };

test('a read asked while it runs joins it; one run, the same answer, and a log line', async () => {
  let runs = 0; const gate = later(); const logged = [];
  const read = sharedRead('jobs', async () => { runs += 1; await gate.promise; return {n: runs}; }, {log: (...line) => logged.push(line)});
  const both = Promise.all([read(), read()]);
  gate.done();
  const [a, b] = await both;
  assert.equal(runs, 1);
  assert.equal(a, b);
  assert.deepEqual(logged, [['run', 'joined the running jobs read', undefined]]);
});

test('different keys run apart; a read after the last one ended runs again', async () => {
  let runs = 0;
  const read = sharedRead('jobs', async limit => { runs += 1; return limit; }, {keyOf: limit => limit});
  assert.deepEqual(await Promise.all([read(200), read(400)]), [200, 400]);
  await read(200);
  assert.equal(runs, 3);
});

test('a failed read fails every caller that joined it, and the next one tries again', async () => {
  let runs = 0;
  const read = sharedRead('focus', async () => { runs += 1; if (runs === 1) throw new Error('Notion 429'); return 'ok'; });
  const results = await Promise.allSettled([read(), read()]);
  assert.deepEqual(results.map(r => r.status), ['rejected', 'rejected']);
  assert.equal(await read(), 'ok');
});

// The class: every window read that starts a Python run goes through sharedRead in main.js.
test('every read handler of the window is shared', async () => {
  const main = mainSource();
  for (const name of ['jobs', 'calendarJobs', 'strategyData', 'ivSaved', 'calendarRecordings', 'focus']) {
    assert.match(main, new RegExp(`ipcMain\\.handle\\('${name}', sharedRead\\(`), `${name} is not a shared read`);
  }
});

// #325: a read that began before a write must not be joined by a read asked after it.
test('a read asked after a finished write starts its own, and the old one does not stick', async () => {
  let runs = 0; const gate = later(); let data = 'old';
  const read = sharedRead('jobs', async () => { runs += 1; const seen = data; if (runs === 1) await gate.promise; return seen; });
  const before = read();                        // started before the write, still running
  await new Promise(resolve => setImmediate(resolve));   // it has begun and read the old data
  data = 'new'; readsChanged();                 // the write finished
  assert.equal(await read(), 'new', 'the read after the write is its own');
  assert.equal(runs, 2);
  const joined = read();                        // asked while neither runs: starts a third
  gate.done();
  assert.equal(await before, 'old');
  assert.equal(await joined, 'new');
});

test('the write handlers that change what reads show close the join: view-cache hooks and afterWrite', async () => {
  let wrote = 0;
  const write = afterWrite(async () => { wrote += 1; return 'ok'; });
  const gate = later(); let runs = 0;
  const read = sharedRead('ivSaved', async () => { const mine = ++runs; await gate.promise; return mine; });
  const first = read();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await write(), 'ok');
  const second = read();
  gate.done();
  assert.deepEqual([await first, await second, wrote], [1, 2, 1]);
  const failing = afterWrite(async () => { throw new Error('refused'); });
  await assert.rejects(failing(), /refused/);
  // every handler that writes goes through writeHandle (afterWrite), not a bare ipcMain.handle
  const fs = await import('node:fs');
  for (const [file, channel] of [['interview-handlers', 'ivSave'], ['interview-handlers', 'ivDelete'], ['focus-handlers', 'interviewHappened'], ['strategy-draft-handlers', 'saveStrategy']]) {
    assert.match(fs.readFileSync(new URL(`../lib/${file}.js`, import.meta.url), 'utf8'), new RegExp(`writeHandle\\('${channel}'`), `${channel} closes the join`);
  }
  const cache = fs.readFileSync(new URL('../lib/view-cache.js', import.meta.url), 'utf8');
  assert.equal((cache.match(/readsChanged\(\)/g) || []).length, 2, 'jobDeleted and statusChanged');
});
