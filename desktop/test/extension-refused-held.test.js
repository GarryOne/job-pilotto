// A captcha met in the refused-site real tab stays in its hidden window; only the person's "Show the check" brings it forward, and once solved the page is read.
// Nothing is clicked, typed or solved by the extension. Guard for extension/refused-held.js and the hand-off from refused-tab.js / refused-read.js.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {hold, show, look, HOLD_MS} from '../../extension/refused-held.js';
import {tabReader} from '../../extension/refused-tab.js';
import {readNowIfAsked} from '../../extension/refused-read.js';

const CAPTCHA = {html: '<title>Verify</title>', title: 'Verify', final: 'https://jobs.coop.ch/'};
const PAGE = {html: '<title>Jobs</title>', title: 'Jobs', final: 'https://jobs.coop.ch/'};

function fakeChrome({snapshot = PAGE, windowAlive = true} = {}) {
  const log = {updated: [], removed: [], created: []};
  let store = {};
  const chrome = {
    runtime: {id: 'abc'},
    extension: {isAllowedIncognitoAccess: done => done(true)},
    storage: {local: {get: async key => ({[key]: store[key]}), set: async patch => { store = {...store, ...patch}; }, remove: async key => { delete store[key]; }}},
    windows: {create: async options => { log.created.push(options); return {id: 7, incognito: true, tabs: [{id: 9, incognito: true}]}; },
      remove: async id => { log.removed.push(id); },
      update: async (id, options) => { log.updated.push([id, options]); return windowAlive ? {id} : Promise.reject(new Error('gone')); }},
    tabs: {update: async () => ({}), create: async () => ({})},
    scripting: {executeScript: async () => [{result: chrome.seen ?? snapshot}]},
    permissions: {contains: async () => true},
  };
  return {chrome, log, kept: () => store};
}

test('a captcha stays in its hidden window: not closed, not blanked, never focused by us', async () => {
  const {chrome, log, kept} = fakeChrome({snapshot: CAPTCHA});
  const reader = tabReader({chrome, judge: async () => ({state: 'captcha'}), now: () => 0, sleep: async () => {}});
  const answer = await reader.read('https://jobs.coop.ch/');
  assert.deepEqual([answer.state, answer.held], ['captcha', true]);
  await reader.close();
  assert.deepEqual(log.removed, [], 'the window is kept for the person');
  assert.deepEqual(log.updated, [], 'nothing focused it');
  assert.equal(log.created[0].focused, false);
  assert.equal(kept().refusedHeld.url, 'https://jobs.coop.ch/');
});

test('only the press of "Show the check" focuses the held window, and a window that is gone is forgotten', async () => {
  const live = fakeChrome();
  await hold({chrome: live.chrome, winId: 7, tabId: 9, url: 'https://jobs.coop.ch/'});
  assert.deepEqual(live.log.updated, []);
  assert.equal(await show(live.chrome), true);
  assert.deepEqual(live.log.updated, [[7, {state: 'normal', focused: true}]]);
  const gone = fakeChrome({windowAlive: false});
  await hold({chrome: gone.chrome, winId: 7, tabId: 9, url: 'https://jobs.coop.ch/'});
  assert.equal(await show(gone.chrome), false);
  assert.equal(gone.kept().refusedHeld, undefined);
  assert.equal(await show(fakeChrome().chrome), false, 'nothing held, nothing to show');
});

test('a check not yet shown is not looked at; once shown and solved the page comes back and the window closes', async () => {
  const {chrome, log, kept} = fakeChrome();
  let clock = 1000, asked = 0;
  const judge = async () => { asked++; return {state: 'page'}; };
  await hold({chrome, winId: 7, tabId: 9, url: 'https://jobs.coop.ch/', now: () => clock});
  assert.equal(await look({chrome, judge, now: () => clock}), null);
  assert.equal(asked, 0, 'not shown: no look, no AI call');
  await show(chrome);
  const page = await look({chrome, judge, now: () => clock});
  assert.equal(page.title, 'Jobs');
  assert.deepEqual(log.removed, [7]);
  assert.equal(kept().refusedHeld, undefined);
});

test('a check still unsolved waits; an old one or a closed window is let go', async () => {
  const {chrome, log} = fakeChrome({snapshot: CAPTCHA});
  let clock = 0;
  await hold({chrome, winId: 7, tabId: 9, url: 'https://jobs.coop.ch/', now: () => clock});
  await show(chrome);
  assert.equal(await look({chrome, judge: async () => ({state: 'captcha'}), now: () => clock}), null);
  assert.deepEqual(log.removed, []);
  clock = HOLD_MS + 1;
  assert.equal(await look({chrome, judge: async () => ({state: 'captcha'}), now: () => clock}), null);
  assert.deepEqual(log.removed, [7], 'too old: closed');
});

test('the app\'s one-minute look hands the press on, and a solved page goes back as a tab-step outcome', async () => {
  const {chrome, log} = fakeChrome();
  await hold({chrome, winId: 7, tabId: 9, url: 'https://jobs.coop.ch/'});
  const sent = [];
  const call = async (_cfg, path, init) => {
    sent.push([path, init?.body ? JSON.parse(init.body) : null]);
    return path === '/extension/refused-pending' ? {ok: true, pending: false, showCheck: true} : path === '/extension/refused-judge' ? {state: 'page'} : {ok: true};
  };
  await readNowIfAsked({chrome, call, config: {}});
  assert.equal(log.updated.length, 1);
  const outcome = sent.find(([path]) => path === '/extension/refused-outcome');
  assert.deepEqual([outcome[1].step, outcome[1].captcha, outcome[1].url], ['tab', undefined, 'https://jobs.coop.ch/']);
});
