// lib/shared-read.js: overlapping reads share one run; a finished or failed one doesn't stick.
import test from 'node:test';
import assert from 'node:assert/strict';
import {sharedRead} from '../lib/shared-read.js';

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
  const fs = await import('node:fs');
  const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  for (const name of ['jobs', 'calendarJobs', 'strategyData', 'ivSaved', 'calendarRecordings', 'focus']) {
    assert.match(main, new RegExp(`ipcMain\\.handle\\('${name}', sharedRead\\(`), `${name} is not a shared read`);
  }
});
