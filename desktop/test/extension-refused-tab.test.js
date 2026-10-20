// The real-tab step of the refused-site ladder (owner, 20 Oct 2026): nothing is opened unless Chrome lets the extension into incognito AND the window reports it is incognito
// (so no cookie or login of the person is ever sent); a passive check gets up to 15 s to clear by itself with no click or typing; a captcha is a stop; five sites a day at most.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tabReader, DAILY_TABS} from '../../extension/refused-tab.js';

const CHECK = {html: '<title>Just a moment</title>', title: 'Just a moment', final: 'https://jobs.coop.ch/'};
const PAGE = {html: '<title>Jobs</title>', title: 'Jobs', final: 'https://jobs.coop.ch/'};

function fakeChrome({allowed = true, incognito = true, snapshots = [PAGE]} = {}) {
  const log = {created: [], navigated: [], removed: [], scripts: 0};
  let store = {}, step = 0;
  const chrome = {
    extension: {isAllowedIncognitoAccess: done => done(allowed)},
    storage: {local: {get: async key => ({[key]: store[key]}), set: async patch => { store = {...store, ...patch}; }}},
    windows: {create: async options => { log.created.push(options); return {id: 7, incognito, tabs: [{id: 9, incognito}]}; }, remove: async id => { log.removed.push(id); }},
    tabs: {update: async (id, options) => { log.navigated.push(options.url); return {}; }},
    scripting: {executeScript: async () => { log.scripts++; return [{result: snapshots[Math.min(step++, snapshots.length - 1)]}]; }},
  };
  return {chrome, log};
}
const reader = (chrome, states, extra = {}) => {
  let clock = 0, asked = 0;
  return {asked: () => asked, ...tabReader({chrome, judge: async () => ({state: states[Math.min(asked++, states.length - 1)]}), now: () => clock, sleep: async ms => { clock += ms; }, ...extra})};
};

test('Chrome does not let the extension into incognito: nothing is opened at all', async () => {
  const {chrome, log} = fakeChrome({allowed: false});
  assert.deepEqual(await reader(chrome, ['page']).read('https://jobs.coop.ch/'), {skipped: 'incognito'});
  assert.deepEqual([log.created, log.navigated], [[], []]);
});

test('a window that does not report incognito is closed and the site is never loaded', async () => {
  const {chrome, log} = fakeChrome({incognito: false});
  assert.deepEqual(await reader(chrome, ['page']).read('https://jobs.coop.ch/'), {skipped: 'no incognito window'});
  assert.deepEqual(log.removed, [7]);
  assert.deepEqual(log.navigated, [], 'no site was loaded in a window that could carry the person\'s cookies');
});

test('the window is one minimized incognito window that never takes focus', async () => {
  const {chrome, log} = fakeChrome();
  const r = reader(chrome, ['page']);
  await r.read('https://jobs.coop.ch/a');
  await r.read('https://jobs.manor.ch/b');
  assert.equal(log.created.length, 1, 'a batch of sites shares one window');
  assert.deepEqual([log.created[0].incognito, log.created[0].state, log.created[0].focused], [true, 'minimized', false]);
  await r.close();
  assert.deepEqual(log.removed, [7]);
});

test('a passive check gets up to fifteen seconds to clear by itself, reading only', async () => {
  const {chrome, log} = fakeChrome({snapshots: [CHECK, CHECK, PAGE]});
  const r = reader(chrome, ['passive_check', 'passive_check', 'page']);
  const answer = await r.read('https://jobs.coop.ch/');
  assert.equal(answer.state, 'page');
  assert.equal(answer.page.title, 'Jobs');
  assert.equal(r.asked(), 3);
  assert.equal(log.scripts, 3, 'the page was only read: one read per look, nothing clicked or typed');
  assert.deepEqual(log.navigated, ['https://jobs.coop.ch/', 'about:blank']);
});

test('a check that never clears stops at fifteen seconds', async () => {
  const {chrome} = fakeChrome({snapshots: [CHECK]});
  const r = reader(chrome, ['passive_check']);
  const answer = await r.read('https://jobs.coop.ch/');
  assert.equal(answer.state, 'passive_check');
  assert.ok(r.asked() <= 5, `${r.asked()} looks in 15 s at one per 3 s`);
});

test('a captcha, a login page or a refusal is a stop at once: waiting is only for a check that clears itself', async () => {
  for (const state of ['captcha', 'login', 'refused']) {
    const {chrome} = fakeChrome({snapshots: [CHECK]});
    const r = reader(chrome, [state]);
    assert.equal((await r.read('https://jobs.coop.ch/')).state, state);
    assert.equal(r.asked(), 1, state);
  }
});

test('five sites a day, then the tab step rests until tomorrow', async () => {
  const {chrome} = fakeChrome();
  const r = reader(chrome, ['page']);
  for (let n = 0; n < DAILY_TABS; n++) assert.equal((await r.read(`https://jobs.site${n}.ch/`)).state, 'page');
  assert.deepEqual(await r.read('https://jobs.site9.ch/'), {skipped: 'budget'});
});
