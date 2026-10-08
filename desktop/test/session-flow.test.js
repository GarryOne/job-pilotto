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

test('an account page the extension could not finish: Claude is OFFERED, never started, and the session says what the person must give', async () => {
  const s = setup({allowed: true});
  terminals.startForm({id: 'f1', url: URL1, company: 'Manor AG'});
  assert.equal(s.flow.stuck({url: URL1, host: 'career55.sapsf.eu', why: 'account', tab: 5, session: 'f1', needs: 'Land/Region des Wohnorts'}), 'offered');
  assert.equal(s.flow.stuck({url: URL1, host: 'career55.sapsf.eu', why: 'account', tab: 5, session: 'f1', needs: 'Land/Region des Wohnorts'}), 'offered');   // reported again: the same, nothing started
  await settle();
  assert.deepEqual(s.started, [], 'Claude is a button the person presses, never started by itself');
  const session = terminals.get('f1');
  assert.deepEqual([session.stuck, session.stage, session.accountNeeds, session.note], ['account', 'account', 'Land/Region des Wohnorts', 'Needs you: Land/Region des Wohnorts']);
  s.flow.stuck({url: URL1, host: 'career55.sapsf.eu', why: 'account', tab: 5, session: 'f1', needs: 'Datenschutzerklärung'});   // a new need replaces the old one
  assert.equal(terminals.get('f1').note, 'Needs you: Datenschutzerklärung');
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

test('a late "account" report about the sign-up page the tab has left never moves the session back from the form', () => {
  const s = setup({allowed: false, states: [{id: 'f1', url: 'https://career55.sapsf.eu/apply', total: 9, left: 9}]});
  terminals.startForm({id: 'f1', url: URL1});
  terminals.setStage('f1', 'form');
  assert.equal(s.flow.stuck({url: URL1, host: 'career55.sapsf.eu', why: 'account', tab: 5, session: 'f1', page: 'https://career55.sapsf.eu/signup'}), 'stale-page');
  assert.equal(terminals.get('f1').stage, 'form');
  assert.equal(terminals.get('f1').stuck, '');
});

test('an account page left to the person says which kind it is: a sign-in is worded as one, in the list and on the card', async () => {
  const {sessionStage} = await import('../renderer/session-state.js');
  const s = setup();
  terminals.startForm({id: 'f1', url: URL1});
  s.flow.stuck({url: URL1, host: 'auth.jobs.ch', why: 'account', needs: 'Log in', accountStep: 'sign_in', session: 'f1'});
  const view = terminals.get('f1');
  assert.equal(view.accountStep, 'sign_in');
  assert.equal(sessionStage(view).text, 'Step 1 of 2 · Sign in on auth.jobs.ch');
  assert.equal(sessionStage({...view, accountStep: 'sign_up'}).text, 'Step 1 of 2 · Creating your account on auth.jobs.ch');
  assert.equal(sessionStage({...view, accountStep: ''}).text.startsWith('Step 1 of 2 · Creating your account'), true);   // no step known: as before
  terminals.startForm({id: 'f2', url: 'https://example.org/jobs/2'});
  s.flow.stuck({url: 'https://example.org/jobs/2', host: 'x.example', why: 'account', accountStep: 'junk', session: 'f2'});
  assert.equal(terminals.get('f2').accountStep || '', '');   // only the two known steps are kept
});
