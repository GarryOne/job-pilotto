// extension/report-recorder.js and lib/report-form.js (spec 2026-10-15-report-this-form.md §1, §7): nothing happens before the press, a sign-in page keeps nothing, only allowed response
// headers are kept, the collector never touches request bodies or cookies, and what it hands over is scrubbed, searched again, held in memory and filtered by the hosts the person drops.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {createRecorder} from '../../extension/report-recorder.js';
import {createHold, finalize, prepare} from '../lib/report-form.js';
import {ownerValuesOf} from '../lib/owner-values.js';

// A fake chrome.debugger: records every command, lets a test fire events, answers getResponseBody from a table.
function fakeChrome(bodies = {}) {
  const calls = [], listeners = new Set();
  const debuggerApi = {
    attach: async target => { calls.push(['attach', target.tabId]); },
    detach: async target => { calls.push(['detach', target.tabId]); },
    sendCommand: async (target, method, params) => { calls.push([method, params]); if (method === 'Network.getResponseBody') return bodies[params.requestId] || {body: '', base64Encoded: false}; return {}; },
    onEvent: {addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn)},
  };
  return {chrome: {debugger: debuggerApi}, calls, emit: (tabId, method, params) => listeners.forEach(fn => fn({tabId}, method, params)), listeners};
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const got = (fake, tab, id, url, {type = 'Document', status = 200, headers = {'Content-Type': 'text/html', 'Set-Cookie': 'sid=SECRET', 'X-Trace': 'abc'}} = {}) => {
  fake.emit(tab, 'Network.requestWillBeSent', {requestId: id, type, request: {url, method: 'GET', headers: {'Sec-Fetch-Mode': 'navigate', Cookie: 'sid=SECRET'}}});
  fake.emit(tab, 'Network.responseReceived', {requestId: id, response: {status, headers}});
  fake.emit(tab, 'Network.loadingFinished', {requestId: id});
};
const attach = fake => async tabId => { await fake.chrome.debugger.attach({tabId}, '1.3'); };
const manual = () => { const timers = []; return {setTimer: (fn, ms) => { timers.push({fn, ms}); return timers.length; }, clearTimer: () => {}, timers}; };

test('nothing is attached, recorded or reloaded before the press; the press attaches, listens, then reloads', async () => {
  const fake = fakeChrome(), recorder = createRecorder({chrome: fake.chrome, attach: attach(fake), ...manual()});
  assert.deepEqual(fake.calls, []);
  assert.equal(fake.listeners.size, 0);
  assert.equal(recorder.isRecording(), false);
  assert.deepEqual(await recorder.start(7), {ok: true});
  const order = fake.calls.map(call => call[0]);
  assert.deepEqual(order, ['attach', 'Network.enable', 'Network.setCacheDisabled', 'Page.enable', 'Page.reload']);
  assert.equal(recorder.isRecording(7), true);
  await recorder.stop();
  assert.equal(fake.listeners.size, 0, 'the listener is gone');
  assert.equal(fake.calls.at(-1)[0], 'detach');
});

test('a page with a password field is refused at the press, and one that gets it later keeps nothing', async () => {
  const fake = fakeChrome(), timers = manual();
  const early = createRecorder({chrome: fake.chrome, attach: attach(fake), hasPassword: async () => true, ...timers});
  assert.deepEqual(await early.start(7), {ok: false, refused: 'login'});
  assert.deepEqual(fake.calls, [], 'no attach, no reload');
  let login = false;
  const later = createRecorder({chrome: fake.chrome, attach: attach(fake), hasPassword: async () => login, ...timers});
  await later.start(7);
  got(fake, 7, 'r1', 'https://jobs.example.test/apply'); await tick();
  login = true;
  await timers.timers.at(-1).fn(); await tick();   // the watch fires
  got(fake, 7, 'r2', 'https://jobs.example.test/more'); await tick();
  assert.deepEqual(await later.stop(), {ok: false, refused: 'login'});
});

test('the Stop button ends a recording and keeps nothing; a stopped extension refuses the press', async () => {
  const fake = fakeChrome(), timers = manual(); let stopped = false;
  const recorder = createRecorder({chrome: fake.chrome, attach: attach(fake), stopped: () => stopped, ...timers});
  await recorder.start(7); got(fake, 7, 'r1', 'https://jobs.example.test/apply'); await tick();
  stopped = true; await timers.timers.at(-1).fn(); await tick();
  assert.deepEqual(await recorder.stop(), {ok: false, refused: 'stopped'});
  const refused = createRecorder({chrome: fakeChrome().chrome, attach: async () => { throw new Error('stopped: the person pressed Stop'); }, ...manual()});
  assert.equal((await refused.start(7)).refused, 'debugger');
});

test('what is kept: responses of this tab only, allowed headers only, no body key, no cookie flag; a redirect, a failure with a reply, a non-http address', async () => {
  const fake = fakeChrome({r1: {body: '<form>hi é</form>', base64Encoded: false}, r2: {body: Buffer.from('alert(1)').toString('base64'), base64Encoded: true}}), recorder = createRecorder({chrome: fake.chrome, attach: attach(fake), ...manual()});
  await recorder.start(7);
  got(fake, 7, 'r1', 'https://jobs.example.test/apply');
  got(fake, 7, 'r2', 'https://jobs.example.test/app.js', {type: 'Script', headers: {'content-type': 'application/javascript', 'set-cookie': 'a=b'}});
  got(fake, 9, 'x', 'https://other.example.test/', {});   // another tab
  fake.emit(7, 'Network.requestWillBeSent', {requestId: 'ws', type: 'Other', request: {url: 'chrome-extension://abc/x.js', method: 'GET', headers: {}}});
  fake.emit(7, 'Network.requestWillBeSent', {requestId: 'r3', type: 'XHR', request: {url: 'https://jobs.example.test/api', method: 'POST', headers: {}, postData: 'name=Rosalind'}});
  fake.emit(7, 'Network.responseReceived', {requestId: 'r3', response: {status: 200, headers: {'content-type': 'application/json'}}});
  fake.emit(7, 'Network.loadingFailed', {requestId: 'r3'});
  fake.emit(7, 'Network.requestWillBeSent', {requestId: 'r4', type: 'Document', request: {url: 'https://jobs.example.test/a', method: 'GET', headers: {}}});
  fake.emit(7, 'Network.requestWillBeSent', {requestId: 'r4', type: 'Document', request: {url: 'https://jobs.example.test/b', method: 'GET', headers: {}}, redirectResponse: {status: 302, headers: {Location: '/b'}}});
  await tick(); await tick();
  const result = await recorder.stop();
  assert.equal(result.ok, true);
  const byUrl = Object.fromEntries(result.entries.map(entry => [entry.url, entry]));
  assert.equal(Object.keys(byUrl).length, 4, Object.keys(byUrl).join());
  assert.deepEqual(byUrl['https://jobs.example.test/apply'].headers, {'content-type': 'text/html'});
  assert.equal(byUrl['https://jobs.example.test/apply'].mode, 'navigate');
  assert.equal(Buffer.from(byUrl['https://jobs.example.test/apply'].body, 'base64').toString(), '<form>hi é</form>');
  assert.equal(byUrl['https://jobs.example.test/app.js'].type, 'script');
  assert.deepEqual(byUrl['https://jobs.example.test/app.js'].headers, {'content-type': 'application/javascript'});
  assert.equal(byUrl['https://jobs.example.test/api'].failed, false, 'a request reported failed after its reply keeps the reply');
  assert.equal(byUrl['https://jobs.example.test/a'].status, 302);
  assert.ok(result.entries.every(entry => entry.bodyKey === '' && entry.hadCookie === false));
  assert.ok(!JSON.stringify(result).match(/SECRET|Rosalind|sid=/), 'no cookie, no request body in what is handed over');
});

test('the raw size is capped: a body over the cap is not kept and the result says so', async () => {
  const fake = fakeChrome({r1: {body: 'x'.repeat(200), base64Encoded: false}}), recorder = createRecorder({chrome: fake.chrome, attach: attach(fake), limits: {maxBytes: 100}, ...manual()});
  await recorder.start(7); got(fake, 7, 'r1', 'https://jobs.example.test/big'); await tick(); await tick();
  const result = await recorder.stop();
  assert.equal(result.truncated, true); assert.equal(result.entries[0].body, null);
});

test('the collector never reads a request body, a cookie or a request header beyond the fetch mode', () => {
  const code = fs.readFileSync(new URL('../../extension/report-recorder.js', import.meta.url), 'utf8').split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n').replace(/\s\/\/ .*$/gm, '');
  assert.ok(!/postData|requestHeaders|getCookies|getAllCookies|getRequestPostData|\bcookie\b|authorization|Fetch\.enable/i.test(code), 'a forbidden read in the collector');
  assert.deepEqual(code.match(/params\.request\.headers/g), ['params.request.headers'], 'one read of the request\'s headers ...');
  assert.ok(code.includes('fetchMode(params.request.headers)'), '... and it goes to the fetch mode only');
});

test('prepare: scrubbed, searched again, held in memory with a readable preview; dropped hosts leave; a hit blocks', async () => {
  const values = ownerValuesOf(['full name: Rosalind Quill\nemail: rosalind.quill@mailbox.test\n']);
  const page = '<h1>Hi Rosalind</h1><input name=a value="Rosalind"><p>x</p>';
  const wire = {entries: [
    {method: 'GET', url: 'https://jobs.example.test/apply?t=abc', type: 'document', mode: 'navigate', startMs: 0, waitMs: 5, bodyKey: '', status: 200, failed: false, headers: {'content-type': 'text/html'}, hadCookie: false, body: Buffer.from(page).toString('base64'), size: 9},
    {method: 'GET', url: 'https://cdn.example.test/w.js', type: 'script', mode: 'no-cors', startMs: 9, waitMs: 5, bodyKey: '', status: 200, failed: false, headers: {'content-type': 'application/javascript'}, hadCookie: false, body: Buffer.from('var a=1').toString('base64'), size: 7},
    {method: 'GET', url: 'http://127.0.0.1:5000/own', type: 'fetch', mode: '', startMs: 9, waitMs: 5, bodyKey: '', status: 200, failed: false, headers: {}, hadCookie: false, body: null, size: 0}], truncated: false};
  const ok = prepare(wire, values);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.preview.hosts.map(one => one.host).sort(), ['cdn.example.test', 'jobs.example.test'], 'the app\'s own address is not part of a record');
  assert.ok(ok.preview.removed.typed >= 1 && ok.preview.removed.own >= 1, JSON.stringify(ok.preview.removed));
  assert.ok(!JSON.stringify([...ok.held.bodies.values()].map(String)).match(/Rosalind/));
  const less = finalize(ok.held, ['cdn.example.test'], values);
  assert.equal(less.ok, true); assert.deepEqual(less.record.entries.map(entry => new URL(entry.url).host), ['jobs.example.test']);
  const leaky = prepare({entries: [{...wire.entries[1], body: Buffer.from('const n = "Quill";').toString('base64')}]}, values);
  assert.equal(leaky.ok, false); assert.deepEqual(leaky.blocked.map(hit => hit.kind), ['name-in-code']);
  const hold = createHold({now: () => 0 }), id = hold.put(ok.held);
  assert.equal(hold.size(), 1); assert.ok(hold.take(id)); assert.equal(hold.take(id), null, 'taken once');
  let t = 0; const old = createHold({now: () => t}); old.put(ok.held); t = 16 * 60e3; assert.equal(old.size(), 0, 'gone after 15 minutes');
});

// 16 Oct 2026: a session-bound page (mid-flow) cannot be reloaded alone; the report starts at the job's posting and records the chain across the redirects, in the record format
// the offline replays read (reports-fetch.test.mjs replays such a record).
test('a report restarts from the posting and keeps the whole chain; reloading the current page keeps only its error page', async () => {
  const chain = (fake, tab) => {
    got(fake, tab, 'p1', 'https://jobs.example.test/posting', {status: 302, headers: {Location: 'https://sso.example.test/go'}});
    got(fake, tab, 'p2', 'https://sso.example.test/go', {status: 302, headers: {Location: 'https://apply.example.test/form?_s=1'}});
    got(fake, tab, 'p3', 'https://apply.example.test/form?_s=1');
  };
  const run = async restart => {
    const fake = fakeChrome({p3: {body: '<form></form>', base64Encoded: false}, e1: {body: 'An error occurred', base64Encoded: false}});
    const send = fake.chrome.debugger.sendCommand;
    fake.chrome.debugger.sendCommand = async (target, method, params) => {
      if (method === 'Page.reload') got(fake, 7, 'e1', 'https://apply.example.test/form?_s=1', {status: 500});   // no session: the site's error page
      return send(target, method, params);
    };
    const recorder = createRecorder({chrome: fake.chrome, attach: attach(fake), ...manual()});
    await recorder.start(7, restart ? {restart: async () => { chain(fake, 7); return true; }} : {});
    await tick(); await tick();
    return {fake, result: await recorder.stop()};
  };
  const old = await run(false), now = await run(true);
  assert.deepEqual(old.result.entries.map(entry => entry.url), ['https://apply.example.test/form?_s=1']);
  assert.equal(old.result.entries[0].status, 500, 'the old start captured only the error page');
  assert.deepEqual(now.result.entries.map(entry => entry.url), ['https://jobs.example.test/posting', 'https://sso.example.test/go', 'https://apply.example.test/form?_s=1']);
  assert.equal(now.fake.calls.some(call => call[0] === 'Page.reload'), false, 'a tab that left for its posting is not reloaded');
  assert.deepEqual(now.result.entries.map(entry => entry.status), [302, 302, 200]);
});
