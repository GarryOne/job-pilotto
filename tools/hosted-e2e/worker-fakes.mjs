// The hosted e2e's Cloudflare, in one Node process: the real Worker (site/src/index.js, routes and cron tick) over an in-memory D1 (every migration, in order), KV, R2, a Queue
// that is drained by the real consumer logic (site/src/hosted-consume.js), a fake sender for the e-mails and the fake AI. Served on a loopback port so the app's client and the engine
// (in Docker or not) talk to it over HTTP like they do to jobpilotto.top. Nothing here reaches a real account.
import fs from 'node:fs';
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import worker from '../../site/src/index.js';
import {seal} from '../../site/src/hosted-state.js';
import {consume} from '../../site/src/hosted-consume.js';
import {fakeAi} from './fake-ai.mjs';

const MIGRATIONS = new URL('../../site/migrations/', import.meta.url);

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of fs.readdirSync(MIGRATIONS).filter(name => name.endsWith('.sql')).sort()) db.exec(fs.readFileSync(new URL(file, MIGRATIONS), 'utf8'));
  const statement = (text, args = []) => ({bind: (...values) => statement(text, values),
    run: async () => { const done = db.prepare(text).run(...args); return {meta: {changes: Number(done.changes)}}; },
    all: async () => ({results: db.prepare(text).all(...args).map(row => ({...row}))}),
    first: async () => { const row = db.prepare(text).get(...args); return row ? {...row} : null; }});
  return {db, prepare: text => statement(text), batch: async list => Promise.all(list.map(item => item.run()))};
}
const kv = () => { const map = new Map(); return {map, get: async key => map.get(key) ?? null, put: async (key, value) => { map.set(key, String(value)); }, delete: async key => { map.delete(key); },
  list: async ({prefix = ''} = {}) => ({keys: [...map.keys()].filter(key => key.startsWith(prefix)).map(name => ({name}))})}; };
const r2 = () => { const map = new Map(); const object = bytes => ({arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)});
  return {map, get: async key => map.has(key) ? object(map.get(key)) : null, head: async key => map.has(key) ? {} : null, delete: async key => { map.delete(key); },
    put: async (key, value) => { map.set(key, new Uint8Array(value instanceof Uint8Array ? value : await new Response(value).arrayBuffer())); }}; };

export async function startCloud({kek = 'e2e-kek-not-a-secret', salt = 'e2e-salt'} = {}) {
  const sent = [], queue = [], ai = fakeAi();
  let runner = null;
  const env = {STATS: d1(), WAITLIST: kv(), HOSTED_STATE: r2(), STATS_SALT: salt, HOSTED_KEK: kek, HOSTED_ALWAYS_ON: 'on', AI: ai, MAIL: 'on', FREE_AI_TRIAL_USD: '2',
    EMAIL: {send: async message => { sent.push(message); return {messageId: `e2e-${sent.length}`}; }}, HOSTED_QUEUE: {send: async message => { queue.push(message); }}};
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const waits = [];
    const request = new Request(`http://127.0.0.1:${server.address().port}${req.url}`, {method: req.method, headers: req.headers, ...(body.length ? {body} : {})});
    const reply = await worker.fetch(request, env, {waitUntil: promise => waits.push(promise)});
    res.writeHead(reply.status, Object.fromEntries(reply.headers));
    res.end(Buffer.from(await reply.arrayBuffer()));
    await Promise.allSettled(waits);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const site = `http://127.0.0.1:${server.address().port}`;
  env.HOSTED_SITE = site;
  return {env, site, sent, ai, queue, setRunner: given => { runner = given; },
    // What an earlier run would have left in R2 (sealed as the Worker seals it): the key shape is src/hosted-state.js keyOf.
    holdState: async (account, bytes) => env.HOSTED_STATE.put(`hosted/${account}/state.tgz`, await seal(env, account, bytes)),
    // The runner Worker's job: take what the tick queued and start the container for each message (the real consume() waits for the run to finish).
    async drain() {
      const messages = queue.splice(0).map(body => ({body, ack() {}}));
      return consume({messages}, () => runner, {error: message => console.error(message)});
    },
    close: () => new Promise(resolve => server.close(resolve))};
}
