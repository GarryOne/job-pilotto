// Ready to send, the 10-minute link and the live view page (src/ready-link.js, public/ready-live.html): the app gets a link with the owner's key, the link opens one job's live view and its "I submitted it", expires, and opens nothing else.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {tokenFor} from '../src/guard.js';
import {ready, start} from '../src/ready.js';
import {viaLink} from '../src/ready-link.js';

const sql = file => readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0015_ai_calls.sql', '0021_ai_cost.sql', '0043_ai_cost_provider.sql', '0079_pro.sql', '0082_pro_trial.sql', '0083_hosted.sql', '0089_ready.sql', '0090_ready_fill_at.sql', '0091_ready_ai_stopped.sql', '0097_ready_line.sql', '0098_ready_turn.sql']) db.exec(sql(file));
  const statement = (text, args = []) => ({bind: (...v) => statement(text, v), run: async () => { const r = db.prepare(text).run(...args); return {meta: {changes: Number(r.changes)}}; },
    all: async () => ({results: db.prepare(text).all(...args).map(r => ({...r}))}), first: async () => { const r = db.prepare(text).get(...args); return r ? {...r} : null; }, text, args});
  return {db, prepare: text => statement(text), batch: async list => { for (const item of list) await item.run(); }};
}
const r2 = () => { const m = new Map(); return {m, put: async (k, v) => { m.set(k, new Uint8Array(v)); }, get: async k => (m.has(k) ? {arrayBuffer: async () => m.get(k).buffer.slice(m.get(k).byteOffset, m.get(k).byteOffset + m.get(k).byteLength)} : null),
  head: async k => (m.has(k) ? {} : null), delete: async k => { m.delete(k); }, list: async ({prefix}) => ({objects: [...m.keys()].filter(k => k.startsWith(prefix)).map(key => ({key}))})}; };
const runner = () => { const seen = []; return {seen, fetch: async request => { seen.push(request.url); return new Response('{}', {status: 200}); }}; };
const env = () => ({STATS: d1(), HOSTED_STATE: r2(), STATS_SALT: 'salt', READY_KEK: 'kek', READY_TO_SEND: 'on', READY_OWNER: 'owner-install-1', READY_OWNER_SECRET: 'owner-secret', READY_RUNNER: runner()});
const keyOf = async install => `JPF1.${install}.${await tokenFor(install, {STATS_SALT: 'salt'}, 'ai')}`;
const now = new Date('2026-10-18T07:00:00Z');
const call = (e, method, path, body, headers = {}, at = now) => ready(new Request(`https://www.jobpilotto.top/api/ready/${path}`, {method, headers, body: body === undefined ? undefined : JSON.stringify(body)}), e, at);
const owner = async () => ({'x-ready-owner': 'owner-secret', 'x-api-key': await keyOf('owner-install-1')});
async function morning() {
  const e = env();
  const made = await (await call(e, 'POST', 'batch', {night: '2026-10-18', jobs: [{id: 'j1', url: 'https://boards.example.com/a/1'}, {id: 'j2', url: 'https://boards.example.com/a/2'}]}, await owner())).json();
  await start(e, made.batch, now);
  return e;
}
const linkFor = async (e, job) => new URL((await (await call(e, 'POST', 'link', {job}, await owner())).json()).url);

test('only the owner gets a link, for a plain job id, and it lasts ten minutes', async () => {
  const e = await morning();
  assert.equal((await call(e, 'POST', 'link', {job: 'j1'}, {'x-ready-owner': 'owner-secret', 'x-api-key': await keyOf('someone-else-9')})).status, 401);
  assert.equal((await call(e, 'POST', 'link', {job: 'j1'})).status, 401);
  assert.equal((await call(e, 'POST', 'link', {job: '../x'}, await owner())).status, 400);
  const reply = await (await call(e, 'POST', 'link', {job: 'j1'}, await owner())).json();
  assert.match(reply.url, /^https:\/\/www\.jobpilotto\.top\/ready-live\?job=j1&k=\d+\./);
  assert.equal(Date.parse(reply.expiresAt) - now.getTime(), 10 * 60 * 1000);
});

test('the link opens its own job\'s live view and "I submitted it", before it expires, and nothing else', async () => {
  const e = await morning(), link = await linkFor(e, 'j1'), k = link.searchParams.get('k');
  const asLink = (path, job = 'j1', method = 'GET', body, at = now) => call(e, method, `${path}?job=${job}&k=${encodeURIComponent(k)}`, body, {}, at);
  assert.equal((await asLink('live')).status, 200);
  assert.equal(e.READY_RUNNER.seen.at(-1).includes('job=j1'), true);
  assert.equal((await asLink('live', 'j2')).status, 401);   // another job
  assert.equal((await asLink('live', 'j1', 'GET', undefined, new Date(now.getTime() + 11 * 60 * 1000))).status, 401);   // expired
  assert.equal((await call(e, 'GET', `live?job=j1&k=${k.slice(0, -2)}xx`)).status, 401);   // forged
  for (const sub of ['handoff', 'held', 'state', 'report', 'done', 'data', 'batch', 'run']) {   // the class: the link opens nothing but live and submitted
    for (const method of ['GET', 'POST', 'DELETE']) {
      const status = (await asLink(sub, 'j1', method, method === 'POST' ? {job: 'j1'} : undefined)).status;
      assert.ok([401, 405].includes(status), `${method} ${sub} -> ${status}`);
    }
  }
  assert.equal((await asLink('submitted', 'j1', 'POST', {job: 'j2'})).status, 401);   // its own job only
  assert.equal((await asLink('submitted', 'j1', 'POST', {job: 'j1'})).status, 200);
  assert.ok(e.STATS.db.prepare("SELECT submitted_at FROM ready_jobs WHERE job = 'j1'").get().submitted_at);
  assert.equal(e.STATS.db.prepare("SELECT submitted_at FROM ready_jobs WHERE job = 'j2'").get().submitted_at, null);
  assert.equal(await viaLink(new Request('https://x/api/ready/live?job=j1'), e, now), null);   // no k
});

test('the live view page sends only mouse and keys, holds no key and does not leak its link', () => {
  const page = readFileSync(new URL('../public/ready-live.html', import.meta.url), 'utf8');
  assert.ok(page.includes('name="referrer" content="no-referrer"') && page.includes('name="robots" content="noindex"'));
  assert.ok(!/https?:\/\/(?!www\.w3)/.test(page.replace(/<!--.*?-->/gs, '')), 'no external address');
  assert.ok(!/x-api-key|localStorage|document\.cookie/.test(page));
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased', 'mouseWheel']) assert.ok(page.includes(type), type);
});

// The live page's states, run on its own script (live demo, 18 Oct 2026: a broken image with its alt text showed while connecting): connecting shows a line and no
// picture; the first frame shows the picture; a close before any frame says so; a close after one keeps the picture.
test('the live page shows the picture only once a frame came, and says why when it closes first', () => {
  const page = readFileSync(new URL('../public/ready-live.html', import.meta.url), 'utf8');
  const script = page.match(/<script>([\s\S]*?)<\/script>/)[1];
  const hiddenAt = id => new RegExp(`id="${id}"[^>]*\\bhidden\\b`).test(page);
  const run = events => {
    const nodes = {};
    for (const id of ['screen', 'state', 'done', 'note', 'wait']) nodes[id] = {id, hidden: hiddenAt(id), textContent: '', disabled: true, src: '', focus() {}, addEventListener() {}};
    let socket;
    const WebSocket = class { constructor() { socket = this; this.readyState = 1; } send() {} };
    new Function('document', 'location', 'WebSocket', 'fetch', script)({getElementById: id => nodes[id]}, {search: '?job=j1&k=1.x', protocol: 'https:', host: 'x'}, WebSocket, async () => ({}));
    for (const event of events) event === 'open' ? socket.onopen() : event === 'close' ? socket.onclose() : socket.onmessage({data: JSON.stringify({kind: event, data: 'AAAA'})});
    return nodes;
  };
  const cases = [
    ['connecting', [], {screen: true, wait: false}, /Opening the filled form/],
    ['open, no frame yet', ['open'], {screen: true, wait: false}, /Opening the filled form/],
    ['first frame', ['open', 'first'], {screen: false, wait: true}, null],
    ['closed before any frame: the server no longer holds it, and what to do', ['open', 'close'], {screen: true, wait: false}, /no longer holds this filled form.*Open in my browser.*Fill now/],
    ['closed after a frame', ['open', 'frame', 'close'], {screen: false, wait: true}, null],
  ];
  for (const [name, events, hidden, says] of cases) {
    const nodes = run(events);
    nodes.wait.textContent ||= page.match(/<div id="wait">([^<]*)</)[1];
    assert.equal(nodes.screen.hidden, hidden.screen, `${name}: picture hidden`);
    assert.equal(nodes.wait.hidden, hidden.wait, `${name}: waiting line hidden`);
    if (says) assert.match(nodes.wait.textContent, says, name);
  }
});
