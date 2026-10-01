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
