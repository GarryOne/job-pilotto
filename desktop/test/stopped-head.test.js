// A run the watchdog stopped says so in its box (what happened, the step, the way out) and its pill says Stopped; the step it
// was on says what it was doing; the log stays folded (owner's targeted fix #4, 6 Oct 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import {runStatus, stoppedHead} from '../renderer/run-status.js';
import {stoppedReason} from '../lib/pipeline.js';

const line = `⚠️ ${stoppedReason('no output for 15 min')} The last thing it did: Descriptions: 0 of 17 missing fetched`;
const run = {kind: 'search', ok: false, log: ['Descriptions: 0 of 17 missing fetched', line]};

test('the watchdog line becomes a stopped head: title, the step in plain words, the advice, Run again', () => {
  const head = stoppedHead(run);
  assert.equal(head.title, 'Stopped after 15 minutes without output');
  assert.equal(head.doing, 'fetching job descriptions');
  assert.equal(head.last, 'Descriptions: 0 of 17 missing fetched');
  assert.match(head.summary, /^The run stopped responding while fetching job descriptions\. The search did not finish/);
  assert.match(head.hint, /Run it again; if it keeps stopping/);
  assert.deepEqual(head.fix, {label: 'Run again', rerun: true});
  assert.deepEqual(runStatus(run, false), ['Stopped', 'bad']);
});

test('read from Notion (the line in the summary), the long-run stop, and runs that were not stopped', () => {
  assert.equal(stoppedHead({kind: 'search', ok: false, summary: stoppedReason('no output for 1 min')}).title, 'Stopped after 1 minute without output');
  assert.equal(stoppedHead({kind: 'search', ok: false, log: [stoppedReason('still running after 45 min')]}).title, 'Stopped after running 45 minutes');
  assert.equal(stoppedHead({kind: 'search', ok: false, log: ['KeyError: x']}), null);
  assert.equal(stoppedHead({...run, ok: true}), null);
  assert.equal(stoppedHead({...run, live: true}), null);
  assert.deepEqual(runStatus({kind: 'search', ok: false, log: ['KeyError']}, false), ['Failed', 'bad']);
});
