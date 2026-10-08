// The Applying flows' decisions in the app (lib/session-flow.js; docs/flows/applying.md): a stuck report, the stage from a form report,
// Claude's hand-over. Real terminals and apply rules; a fake review, window and Claude. Each test is one row of the matrix.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as terminals from '../lib/terminals.js';
import * as apply from '../lib/apply.js';
import {createSessionFlow} from '../lib/session-flow.js';

const URL1 = 'https://www.jobs.ch/en/vacancies/detail/manor/';
function setup({allowed = true, older = () => false, states = [], startClaude} = {}) {
  terminals._reset();
  terminals.usePty(async () => ({spawn: () => ({onData: () => {}, onExit: () => {}, write: () => {}, resize: () => {}, kill: () => {}})}));
  const logs = [], started = [], closed = [], windows = [];
  const review = {olderTab: older, allStates: () => states, queueClose: () => {}};
  const flow = createSessionFlow({terminals, review, apply, appLog: (area, text) => logs.push(`${area}: ${text}`), toWindow: (...args) => windows.push(args),
    startClaude: startClaude || (async url => { started.push(url); return {ok: true, session: {id: 'c9'}}; }), claudeAllowed: () => allowed,
    closeTab: async session => { closed.push(session.id); return true; }});
  return {flow, logs, started, closed, windows};
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('a sign-in page on a form session hands the job to Claude once, and its Claude starts at the account step', async () => {
  const s = setup();
  terminals.startForm({id: 'f1', url: URL1, company: 'Manor AG'});
  assert.equal(s.flow.stuck({url: URL1, host: 'career55.sapsf.eu', why: 'account', tab: 5, session: 'f1'}), 'hand-over');
  assert.equal(s.flow.stuck({url: URL1, host: 'career55.sapsf.eu', why: 'account', tab: 5, session: 'f1'}), 'claude-open');   // reported again while it starts
  await settle();
  assert.deepEqual(s.started, [URL1]);
  assert.deepEqual([terminals.get('f1').stuck, terminals.get('f1').stage], ['account', 'account']);
  assert.ok(s.logs.includes('extension: account page: Claude takes over'));
});

test('without Apply with Claude allowed the account page is left to the person, and says so', () => {
  const s = setup({allowed: false});
  terminals.startForm({id: 'f1', url: URL1});
  assert.equal(s.flow.stuck({url: URL1, host: 'career55.sapsf.eu', why: 'account', session: 'f1'}), 'not-allowed');
  assert.deepEqual(s.started, []);
});

test('the posting behind the sign-in says "no form" afterwards: an older tab is ignored, and the account step stays either way', () => {
  const s = setup({allowed: false, older: (id, tab) => tab === 3});
  terminals.startForm({id: 'f1', url: URL1});
  s.flow.stuck({url: URL1, host: 'career55.sapsf.eu', why: 'account', tab: 5, session: 'f1'});
  assert.equal(s.flow.stuck({url: URL1, host: 'live.solique.ch', why: 'no-form', tab: 3, session: 'f1'}), 'older-tab');
  s.flow.stuck({url: URL1, host: 'www.jobs.ch', why: 'no-form'});   // carrying no session: matched by its job, still never downgrades
  assert.equal(terminals.get('f1').stuck, 'account');
});

test('a Claude session at a sign-in page is marked at the account step; no second Claude', async () => {
  const s = setup();
  await terminals.start({id: 'c1', url: URL1, kind: 'claude', file: 'claude'});
  assert.equal(s.flow.stuck({url: URL1, host: 'career2.successfactors.eu', why: 'account', session: 'c1'}), 'no-session');
  assert.deepEqual([terminals.get('c1').stage, terminals.get('c1').accountHost], ['account', 'career2.successfactors.eu']);
  assert.deepEqual(s.started, []);
});

test('a form report: an account page keeps the account step; the application form moves to the form step and clears "can\'t reach"', () => {
  const s = setup();
  terminals.startForm({id: 'f1', url: URL1});
  terminals.noteStuck('f1', 'no-form');
  s.flow.reported({id: 'f1', url: 'https://career55.sapsf.eu/careers', total: 3, left: 3, account: true});
  assert.deepEqual([terminals.get('f1').stage, terminals.get('f1').stuck], ['account', 'no-form']);
  s.flow.reported({id: 'f1', url: 'https://career55.sapsf.eu/apply', total: 9, left: 9});
  assert.deepEqual([terminals.get('f1').stage, terminals.get('f1').stuck], ['form', '']);
  assert.equal(s.windows.length, 2);   // each report reaches the window
});

test('Claude\'s hand-over closes the form tab only when nothing was filled there, then the form session goes', async () => {
  const empty = setup({states: [{id: 'f1', total: 3, left: 3}]});
  terminals.startForm({id: 'f1', url: URL1});
  await empty.flow.handOver(URL1);
  assert.deepEqual(empty.closed, ['f1']);
  assert.equal(terminals.get('f1'), null);
  const filled = setup({states: [{id: 'f2', total: 9, left: 2}]});
  terminals.startForm({id: 'f2', url: URL1});
  await filled.flow.handOver(URL1);
  assert.deepEqual(filled.closed, []);
  assert.ok(filled.logs.some(line => /form tab of f2 kept/.test(line)));
});
