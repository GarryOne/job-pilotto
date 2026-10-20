// The extension's side of "Read refused sites in my browser" (owner, 19 Oct 2026): nothing unless the app lists sites (it does so only when the setting is on), every fetch
// without cookies, one at a time, never a login-wall site even if the app lists one, and every page or failure goes back to the app.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pass, mayFetch, readNowIfAsked, ALARM, NOW_ALARM, MAX_SITES} from '../../extension/refused-read.js';

const chromeWith = allowed => ({permissions: {contains: async () => allowed}});
function harness({on = true, sites = [], allowed = true, pages = {}} = {}) {
  const calls = [], fetched = [];
  let open = 0, most = 0;
  const call = async (_cfg, path, init) => {
    calls.push([path, init?.body ? JSON.parse(init.body) : null]);
    return path === '/extension/refused-queue' ? {ok: true, on, sites} : {ok: true};
  };
  const fetchPage = async (url, init) => {
    open++; most = Math.max(most, open);
    fetched.push([url, init]);
    await new Promise(resolve => setTimeout(resolve, 1));
    open--;
    const page = pages[url] || {status: 200, text: '<html><title>Jobs</title></html>'};
    if (page.throws) throw new Error(page.throws);
    return {status: page.status, url: page.final || url, text: async () => page.text};
  };
  return {calls, fetched, run: () => pass({chrome: chromeWith(allowed), call, config: {}, fetchPage, pause: async () => {}}), most: () => most};
}

test('the setting off or no permission: nothing is fetched', async () => {
  for (const options of [{on: false, sites: [{url: 'https://jobs.coop.ch'}]}, {allowed: false, sites: [{url: 'https://jobs.coop.ch'}]}]) {
    const h = harness(options);
    assert.equal((await h.run()).read, 0);
    assert.deepEqual(h.fetched, []);
  }
});

test('each site is fetched once, without cookies, one at a time, and its page goes back to the app', async () => {
  const sites = [{url: 'https://jobs.coop.ch'}, {url: 'https://www.monsterboard.nl/v?q=a'}];
  const h = harness({sites, pages: {'https://www.monsterboard.nl/v?q=a': {status: 429, text: ''}}});
  assert.equal((await h.run()).read, 2);
  assert.ok(h.fetched.every(([, init]) => init.credentials === 'omit' && init.redirect === 'follow'), 'no cookies, no logins');
  assert.equal(h.most(), 1);
  const outcomes = h.calls.filter(([path]) => path === '/extension/refused-outcome').map(([, body]) => [body.url, body.status, body.title]);
  assert.deepEqual(outcomes, [['https://jobs.coop.ch', 200, 'Jobs'], ['https://www.monsterboard.nl/v?q=a', 429, '']]);
  assert.equal(h.calls.at(-1)[0], '/extension/refused-done');
});

test('a login-wall site the app lists is never fetched, a failed fetch is reported, and the list is capped', async () => {
  for (const host of ['www.linkedin.com', 'de.indeed.com', 'www.glassdoor.com', 'www.levels.fyi', 'www.reddit.com']) assert.equal(mayFetch(`https://${host}/jobs`), false, host);
  assert.equal(mayFetch('http://jobs.coop.ch'), false, 'https only');
  const h = harness({sites: [{url: 'https://www.linkedin.com/jobs'}, {url: 'https://down.example.ch'}], pages: {'https://down.example.ch': {throws: 'network'}}});
  await h.run();
  assert.deepEqual(h.fetched.map(([url]) => url), ['https://down.example.ch']);
  assert.equal(h.calls.filter(([path, body]) => path === '/extension/refused-outcome' && body.status === 0).length, 2, 'both reported to the app: one skipped, one failed');
  const many = harness({sites: Array.from({length: 40}, (_, n) => ({url: `https://s${n}.example.ch`}))});
  await many.run();
  assert.equal(many.fetched.length, MAX_SITES);
  assert.equal(ALARM, 'refused-reads');
});

test('Read now: the extension looks every minute and only reads when the app says one is waiting', async () => {
  assert.notEqual(NOW_ALARM, ALARM);
  for (const [pending, reads] of [[true, 1], [false, 0]]) {
    const paths = [];
    const call = async (_cfg, path) => { paths.push(path); return path === '/extension/refused-pending' ? {ok: true, pending} : path === '/extension/refused-queue' ? {ok: true, on: true, sites: [{url: 'https://jobs.coop.ch'}]} : {ok: true}; };
    const fetchPage = async url => ({status: 200, url, text: async () => '<html></html>'});
    const answer = await readNowIfAsked({chrome: chromeWith(true), call, config: {}, fetchPage, pause: async () => {}});
    assert.equal(answer.read, reads);
    assert.equal(paths.includes('/extension/refused-queue'), pending, 'the engine is only asked when a Read now waits');
  }
});
