// The application the extension reports as submitted (POST /extension/applied) is marked Applied in Notion — and
// the Claude session that filled that form is over too. It may not stay in Application sessions as if it were
// still working: that is the "I submitted it" button's own end, without pressing the button.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as server from '../lib/server.js';
import * as terminals from '../lib/terminals.js';

function fakePty() {
  const spawned = [];
  return {spawned, loader: async () => ({spawn: (file, args, options) => {
    const handlers = {};
    const term = {file, args, options, written: [], killed: false,
      onData: fn => { handlers.data = fn; }, onExit: fn => { handlers.exit = fn; },
      write: data => term.written.push(data), resize: () => {}, kill: () => { term.killed = true; handlers.exit?.({exitCode: 0}); },
      emit: data => handlers.data(data)};
    spawned.push(term);
    return term;
  }})};
}

const fakeStorage = () => ({settings: () => ({}), secret: () => 'token', setSecret: () => {}});

test('the session behind a reported submit ends: marked submitted, then gone from Application sessions', async () => {
  terminals._reset();
  terminals.usePty(fakePty().loader);
  await terminals.start({id: 'c1', url: 'https://job-boards.greenhouse.io/canonical/jobs/3014391',
                         title: 'Software Engineer - Data Infrastructure', company: 'Canonical', claudeId: 'conv-c1',
                         file: 'claude', env: {}});
  const record = terminals.record('c1');
  assert.equal(server.sessionSubmitted('https://job-boards.greenhouse.io/canonical/jobs/3014391'), 'c1');
  assert.equal(terminals.get('c1'), null);        // gone from Application sessions
  assert.equal(record.outcome, 'submitted');      // and its statistics say why it ended (lib/session-runs.js)
  assert.ok(record.decidedAt);
  terminals._reset();
});

test('another job\'s session is left alone, and a URL with no session is harmless', async () => {
  terminals._reset();
  terminals.usePty(fakePty().loader);
  await terminals.start({id: 'o1', url: 'https://jobs.test/other', company: 'Other', file: 'claude', env: {}});
  assert.equal(server.sessionSubmitted('https://job-boards.greenhouse.io/canonical/jobs/3014391'), null);
  assert.notEqual(terminals.get('o1'), null);
  terminals._reset();
});

test('a fresh job list ends the sessions of jobs already Applied, and only those', async () => {
  terminals._reset();
  terminals.usePty(fakePty().loader);
  await terminals.start({id: 'a1', url: 'https://jobs.test/canonical/3014391', company: 'Canonical', file: 'claude', env: {}});
  await terminals.start({id: 'b2', url: 'https://jobs.test/canonical/5002072', company: 'Canonical', file: 'claude', env: {}});
  const jobs = [
    {url: 'https://jobs.test/canonical/3014391', stage: 'Applied'},              // the form was submitted
    {url: 'https://jobs.test/canonical/5002072', stage: 'Applying'},             // filled, not submitted: ask
    {url: 'https://jobs.test/acme/1', stage: 'Applied'}];                        // no session for it
  assert.deepEqual(server.appliedSessions(jobs), ['https://jobs.test/canonical/3014391']);
  assert.deepEqual(server.reconcileAppliedSessions(jobs), ['https://jobs.test/canonical/3014391']);
  assert.equal(terminals.get('a1'), null);            // gone: its job is Applied
  assert.notEqual(terminals.get('b2'), null);         // still Applying: the "Did you submit?" question owns it
  assert.deepEqual(server.reconcileAppliedSessions(jobs), []);  // idempotent: every jobs read can call it
  terminals._reset();
});

test('a rejected or interviewing job also ends its session; a trailing slash is the same job', async () => {
  terminals._reset();
  terminals.usePty(fakePty().loader);
  await terminals.start({id: 'r1', url: 'https://jobs.test/acme/9/', company: 'Acme', file: 'claude', env: {}});
  assert.deepEqual(server.reconcileAppliedSessions([{url: 'https://jobs.test/acme/9', stage: 'Rejected'}]), ['https://jobs.test/acme/9/']);
  assert.equal(terminals.get('r1'), null);
  terminals._reset();
});
