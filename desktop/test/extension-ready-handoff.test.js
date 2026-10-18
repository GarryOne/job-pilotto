// "Open in my browser" in the extension (extension/ready-handoff.js): a marked tab asks the app once while it first loads; with a hand-off its
// cookies are set and the tab goes on to the night's page with the same fill mark; when that page is loaded the night's values come back once,
// then the normal fill runs. Each state, and the page side on a small fake page (never a password, a file, a hidden field, or over a value).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createReadyHandoff, restoreInPage} from '../../extension/ready-handoff.js';

const HANDOFF = {url: 'https://job-boards.greenhouse.io/acme/jobs/1#x', cookies: [{url: 'https://job-boards.greenhouse.io/', name: 'gh', value: 'a'}, {url: 'https://job-boards.greenhouse.io/', name: 'bad', value: 'b'}],
  localStorage: {draft: '1'}, sessionStorage: {}, snapshot: {fields: [{id: 'first_name', type: 'text', value: 'Ada'}], files: []}};
const MARKED = 'https://job-boards.greenhouse.io/acme/jobs/1?gh_src=x#jobpilotto-fill=s1';

function world(answer) {
  const session = {}, cookies = [], updates = [], scripts = [], asks = [];
  const chrome = {
    storage: {session: {set: async items => Object.assign(session, items)}},
    cookies: {set: async cookie => (cookie.name === 'bad' ? null : (cookies.push(cookie), cookie))},
    scripting: {executeScript: async ({func, args}) => { scripts.push(args[0]); return [{result: 1}]; }},
  };
  const api = async (path, init) => { asks.push([path, JSON.parse(init.body).url]); return answer; };
  const sessionGet = async name => ({[name]: session[name]});
  const move = async (tabId, url) => { updates.push([tabId, url]); };
  return {flow: createReadyHandoff({chrome, api, sessionGet, move}), session, cookies, updates, scripts, asks};
}

test('no hand-off for this tab: asked once, nothing changes, the normal fill goes on', async () => {
  const w = world({ok: true, handoff: null});
  assert.equal(await w.flow.takeHandoff(7, MARKED, 'complete'), false, 'only while loading');
  assert.equal(await w.flow.takeHandoff(7, MARKED, 'loading'), false);
  assert.equal(await w.flow.takeHandoff(7, MARKED, 'loading'), false);
  assert.deepEqual(w.asks, [['/extension/ready-handoff', MARKED]], 'asked once');
  assert.equal(await w.flow.restoreHandoff(7), 0);
  assert.deepEqual([w.updates, w.scripts], [[], []]);
});

test('the app is not there: no hand-off, the tab is left alone', async () => {
  const w = world(null);
  w.flow = createReadyHandoff({chrome: {storage: {session: {set: async items => Object.assign(w.session, items)}}}, api: async () => { throw new Error('no app'); },
    sessionGet: async name => ({[name]: w.session[name]})});
  assert.equal(await w.flow.takeHandoff(7, MARKED, 'loading'), false);
});

test('a hand-off: its cookies set, the night\'s page loaded with the same mark, the values back once when it is loaded', async () => {
  const w = world({ok: true, handoff: HANDOFF});
  assert.equal(await w.flow.takeHandoff(7, MARKED, 'loading'), true);
  assert.deepEqual(w.cookies.map(c => c.name), ['gh'], 'a cookie Chrome refuses is skipped');
  assert.deepEqual(w.updates, [[7, 'https://job-boards.greenhouse.io/acme/jobs/1#jobpilotto-fill=s1']], 'the fill mark (the app\'s session) goes with it');
  assert.equal(await w.flow.takeHandoff(7, 'https://job-boards.greenhouse.io/acme/jobs/1#jobpilotto-fill=s1', 'loading'), false, 'the second load is not asked again');
  assert.equal(await w.flow.restoreHandoff(7), 1);
  assert.equal(w.scripts[0].snapshot.fields[0].value, 'Ada');
  assert.equal(await w.flow.restoreHandoff(7), 0, 'once');
});

function page(nodes) {
  const store = () => { const data = {}; return {getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; }, data}; };
  const events = [];
  for (const node of nodes) node.dispatchEvent = event => events.push([node.id || node.name, event.type]);
  globalThis.document = {getElementById: id => nodes.find(n => n.id === id) || null, getElementsByName: name => nodes.filter(n => n.name === name)};
  globalThis.localStorage = store(); globalThis.sessionStorage = store();
  globalThis.Event = class { constructor(type) { this.type = type; } };
  return events;
}

test('the page side puts back each field it can name, and nothing else', () => {
  const nodes = [{id: 'first_name', type: 'text', value: ''}, {name: 'job_application[phone]', type: 'tel', value: ''}, {name: 'dup', type: 'text', value: ''}, {name: 'dup', type: 'text', value: ''},
    {id: 'pw', type: 'password', value: ''}, {id: 'consent', type: 'checkbox', checked: false}, {id: 'city', type: 'text', value: 'Already typed'}, {id: 'cv', type: 'file', value: ''}, {id: 'tok', type: 'hidden', value: ''}];
  const events = page(nodes);
  globalThis.localStorage.setItem('kept', 'mine');
  const restored = restoreInPage({localStorage: {draft: '1', kept: 'night'}, sessionStorage: {step: '2'}, snapshot: {fields: [
    {id: 'first_name', type: 'text', value: 'Ada'}, {name: 'job_application[phone]', type: 'tel', value: '+41 00 000 00 00'}, {name: 'dup', type: 'text', value: 'x'},
    {id: 'pw', type: 'password', value: 'never'}, {id: 'consent', type: 'checkbox', value: true}, {id: 'city', type: 'text', value: 'Basel'}, {id: 'cv', type: 'file', value: 'C:\\fakepath\\cv.pdf'},
    {id: 'tok', type: 'hidden', value: 'csrf'}, {id: 'gone', type: 'text', value: 'moved'}]}});
  assert.equal(restored, 3, 'first name, phone by its one name, the checkbox');
  assert.equal(nodes[0].value, 'Ada'); assert.equal(nodes[1].value, '+41 00 000 00 00'); assert.equal(nodes[5].checked, true);
  assert.equal(nodes[2].value, '', 'a name two fields share is not guessed');
  assert.equal(nodes[4].value, '', 'never a password'); assert.equal(nodes[6].value, 'Already typed', 'never over a value'); assert.equal(nodes[8].value, '', 'never a hidden field');
  assert.deepEqual(events.filter(([, type]) => type === 'change').map(([who]) => who), ['first_name', 'job_application[phone]', 'consent']);
  assert.deepEqual(globalThis.localStorage.data, {kept: 'mine', draft: '1'}, 'storage added, never overwritten');
  assert.equal(globalThis.sessionStorage.data.step, '2');
});
