import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ORPHAN, orphans, seconds, stale, watchOrphans} from '../lib/orphans.js';

const PY = '/opt/homebrew/Cellar/python@3.12/3.12.6/Frameworks/Python.framework/Versions/3.12/Resources/Python.app/Contents/MacOS/Python';
const PS = [
  `40107     1   21:14   0:31.79 ${PY} -m src daily --mode scheduled --send --log-run --insight`,   // the hung search: orphaned
  `60703 60436   09:06   0:00.07 ${PY} -m src daily --mode kits --send --log-run`,                   // the app's own child
  `70001 70000   12:00   0:05.00 ${PY} -m src daily --mode run`,                                      // a terminal run (a shell is its parent)
  `80001     1 07-18:50:58  0:01.00 /usr/bin/python3 -m http.server`,                                 // not the engine
].join('\n');

test('only an engine run whose parent is process 1 is an orphan', () => {
  assert.deepEqual(orphans(PS).map(run => [run.pid, run.elapsed, run.cpu]), [[40107, 21 * 60 + 14, 31.79 + 0]]);
  assert.equal(seconds('1-02:03:04'), 93784);
  assert.ok(Number.isNaN(seconds('nonsense')));
});

test('quiet for the limit, or running too long, is stopped; one that still uses CPU is not', () => {
  const seen = new Map(), run = {pid: 1, elapsed: 20 * 60, cpu: 30};
  assert.deepEqual(stale([run], seen, 0), []);
  assert.deepEqual(stale([run], seen, ORPHAN.quietMs - 1), []);
  assert.match(stale([run], seen, ORPHAN.quietMs)[0].why, /no CPU use for 10 min/);
  const working = new Map();
  stale([run], working, 0);
  assert.deepEqual(stale([{...run, cpu: 40}], working, ORPHAN.quietMs), [], 'its CPU time moved, so the quiet clock restarted');
  assert.match(stale([{pid: 2, elapsed: 50 * 60, cpu: 5}], new Map(), 0)[0].why, /running 50 min/);
});

test('the watchdog stops a stuck orphan with SIGTERM and says so in the log', {skip: process.platform === 'win32' && 'the watchdog is Mac/Linux only'}, async () => {
  const sent = [], logged = [];
  const limits = {quietMs: 0, totalMs: ORPHAN.totalMs, killAfterMs: 10};
  const stop = watchOrphans((...args) => logged.push(args), {every: 1e9, limits, list: async () => PS, kill: (pid, signal) => { sent.push([pid, signal]); if (signal === 0) throw new Error('gone'); }});
  await new Promise(resolve => setTimeout(resolve, 50));
  stop();
  assert.deepEqual(sent.slice(0, 1), [[40107, 'SIGTERM']]);
  assert.equal(logged[0][0], 'run');
  assert.match(logged[0][1], /stopping an engine run/);
  assert.equal(JSON.stringify(logged[0][2]).includes('--send'), false, 'no command line in the log');
});
