// The model-call cache of the e2e harness (spec: speed-5x landing 1, owner 11 Oct 2026): a live pool run keeps each answer the model gave, keyed by a hash of the
// request with its volatile parts normalised, so an offline replay of that run gets the same answers at once and asks the model only for what really changed.
// It exists only under the e2e env (JOB_PILOTTO_E2E and JOB_PILOTTO_MODEL_MEMO=<file>): the person's app never memoizes, and never into the app's own folder.
// The file holds the hash and the answer, never the request text. Wired in one place: lib/ai/index.js client(). Guard: desktop/test/model-memo.test.js.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fakeContacts} from '../live-capture.js';

// Volatile parts of a request: an address's query or fragment, a timestamp, a uuid, a long hex id, a run of 6+ digits (an epoch, a job id in a path).
// Short numbers stay (a field id, a count, the digest's [n]); the order of everything stays (a numbered list's number is the answer).
const NORMALISE = [
  [/(https?:\/\/[^\s"'<>?#\\]+)[?#][^\s"'<>\\]*/g, '$1'],
  [/\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:?\d\d)?/g, '<time>'],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>'],
  [/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{16,}\b/gi, '<hex>'],
  [/\d{6,}/g, '<n>'],
];
// Contacts last (after the volatile parts, so a long id is not read as a phone), as the page capture scrubs them (lib/live-capture.js fakeContacts): the live run's ask saw the page's real email or phone, its replay sees the
// scrubbed page; both must be one key (11 Oct 2026: every page with an address missed its kept answer).
export const normalise = text => fakeContacts(NORMALISE.reduce((out, [pattern, to]) => out.replace(pattern, to), text));

// The request as the model sees it: model, system, messages, output schema, tools (max_tokens and the like do not change the answer's meaning).
export function memoKey(params = {}) {
  const asked = {model: params.model, system: params.system ?? '', messages: params.messages ?? [], output_config: params.output_config ?? null, tools: params.tools ?? null};
  return crypto.createHash('sha256').update(normalise(JSON.stringify(asked))).digest('hex');
}

// The request's PARTS, as short hashes (never text): the model, each system block, and the user message cut by its <tag> blocks (or, for a message without tags, by its "Label:" lines).
// Kept beside each answer, so a replay's miss can say WHICH part differs from the live ask ("job differs", "system:1 differs") instead of only "not in its kept answers" (12 Oct 2026, Ashby).
const piece = text => crypto.createHash('sha256').update(normalise(String(text))).digest('hex').slice(0, 12);
const textOf = content => (Array.isArray(content) ? content.map(block => block?.text ?? '').join('\n') : String(content ?? ''));
export function memoParts(params = {}) {
  const parts = {model: piece(params.model ?? '')}, add = (name, text) => { let at = name, n = 1; while (at in parts) at = `${name}#${++n}`; parts[at] = piece(text); };
  const system = params.system ?? '';
  if (Array.isArray(system)) system.forEach((block, i) => add(`system:${i}`, block?.text ?? '')); else add('system', system);
  for (const message of params.messages ?? []) {
    const text = textOf(message.content), tagged = [...text.matchAll(/<([a-z_]+)>([\s\S]*?)<\/\1>/g)];
    if (tagged.length) { for (const [, tag, inner] of tagged) add(`${message.role}:${tag}`, inner); add(`${message.role}:rest`, text.replace(/<([a-z_]+)>[\s\S]*?<\/\1>/g, '').trim()); if (parts[`${message.role}:rest`] === piece('')) delete parts[`${message.role}:rest`]; }
    else for (const line of text.split('\n')) add(`${message.role}:${/^([A-Za-z][^:]{0,30}):/.exec(line)?.[1] || 'line'}`, line);
  }
  add('output', JSON.stringify([params.output_config ?? null, params.tools ?? null]));
  return parts;
}
// The kept ask nearest to this one (fewest differing parts), among the answers kept with their parts: -> the names of the parts that differ, or null when none was kept with parts.
export function nearestDiffers(parts, kept) {
  let best = null;
  for (const [name, other] of Object.entries(kept)) {
    if (!name.endsWith(PARTS)) continue;
    const names = new Set([...Object.keys(parts), ...Object.keys(other)]), differs = [...names].filter(part => parts[part] !== other[part]);
    if (!best || differs.length < best.length) best = differs;
  }
  return best;
}
const PARTS = '#parts';

const insideRealData = file => (path.resolve(file) + path.sep).startsWith(path.join(os.homedir(), 'Library', 'Application Support', 'Job Pilotto') + path.sep);

// -> the cache file for this process, or '' (no cache).
export function memoFile(env = process.env) {
  const file = env.JOB_PILOTTO_E2E ? String(env.JOB_PILOTTO_MODEL_MEMO || '') : '';
  return file && !insideRealData(file) ? file : '';
}

// Memo-only (an offline row replay, e2e/lib/offline-app.mjs): a miss is refused, never asked: the plan's claude -p carries the signed-in account (11 Oct 2026:
// a form answer guessed the owner's name from it), so an offline replay answers only what the live run already asked.
export const memoOnly = (env = process.env) => !!env.JOB_PILOTTO_E2E && env.JOB_PILOTTO_MODEL_MEMO_ONLY === '1';

const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };

// Wraps the client's messages.create in place (the adapter keeps its engine, billing, fallback). A failed ask is not kept. -> the same client.
export function withMemo(client, file = memoFile(), {only = memoOnly()} = {}) {
  if (!client || !file) return client;
  const ask = client.messages.create.bind(client.messages);
  client.messages = {...client.messages, create: async params => {
    const key = memoKey(params), kept = read(file);
    // An offline replay serves the page scrubbed (lib/live-capture.js fakeContacts): the answer the AI gave to the live page is scrubbed the same way, so an address it
    // read off the page (apply_email) is still on the replayed page.
    if (kept[key]) return only ? JSON.parse(fakeContacts(JSON.stringify(kept[key]))) : kept[key];
    if (only) {
      // JOB_PILOTTO_MODEL_MEMO_MISSES=<file> (e2e only): the normalised request of each miss, to see what differs from the live run's ask.
      if (process.env.JOB_PILOTTO_E2E && process.env.JOB_PILOTTO_MODEL_MEMO_MISSES) try { fs.appendFileSync(process.env.JOB_PILOTTO_MODEL_MEMO_MISSES, `${normalise(JSON.stringify({model: params.model, system: params.system ?? '', messages: params.messages ?? [], output_config: params.output_config ?? null, tools: params.tools ?? null}))}\n`); } catch { /* a debug aid */ }
      const differs = nearestDiffers(memoParts(params), kept);
      throw new Error(`model memo: not in the row's kept answers (an offline replay never asks the model)${differs ? `; the nearest kept ask differs in: ${differs.join(', ') || 'nothing I can see (the same parts)'}` : ''}`);
    }
    const answer = await ask(params);
    try {
      fs.mkdirSync(path.dirname(file), {recursive: true});
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({...read(file), [key]: answer, [key + PARTS]: memoParts(params)}));
      fs.renameSync(tmp, file);
    } catch { /* the cache is only a speed-up */ }
    return answer;
  }};
  return client;
}
