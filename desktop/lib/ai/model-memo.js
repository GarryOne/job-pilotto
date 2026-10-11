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
const TAGGED = /<([a-z_]+)>([\s\S]*?)<\/\1>/g;
const piece = text => crypto.createHash('sha256').update(normalise(String(text))).digest('hex').slice(0, 12);
const textOf = content => (Array.isArray(content) ? content.map(block => block?.text ?? '').join('\n') : String(content ?? ''));
// The request cut into its named parts: add(name, text) for each (a part name repeated gets #2, #3). Shared by the hashes and the clock-time check.
function walkParts(params, add) {
  const system = params.system ?? '';
  const blocks = Array.isArray(system) ? system.map(block => block?.text ?? '') : [system];
  blocks.forEach((text, i) => { const at = Array.isArray(system) ? `system:${i}` : 'system'; add(at, text); for (const [, tag, inner] of text.matchAll(TAGGED)) add(`${at}:${tag}`, inner); });   // a system block's own <tag> sections too: which one differs
  for (const message of params.messages ?? []) {
    const text = textOf(message.content), tagged = [...text.matchAll(/<([a-z_]+)>([\s\S]*?)<\/\1>/g)];
    if (tagged.length) { for (const [, tag, inner] of tagged) add(`${message.role}:${tag}`, inner); const rest = text.replace(/<([a-z_]+)>[\s\S]*?<\/\1>/g, '').trim(); if (rest) add(`${message.role}:rest`, rest); }
    else for (const line of text.split('\n')) add(`${message.role}:${/^([A-Za-z][^:]{0,30}):/.exec(line)?.[1] || 'line'}`, line);
  }
  add('output', JSON.stringify([params.output_config ?? null, params.tools ?? null]));
}
export function memoParts(params = {}) {
  const parts = {model: piece(params.model ?? '')};
  walkParts(params, (name, text) => { let at = name, n = 1; while (at in parts) at = `${name}#${++n}`; parts[at] = piece(text); });
  return parts;
}
// The parts whose text carries a clock time or a date after the key's own normalisation (an ISO timestamp is already ignored): "kept from Notion (16:17)" in a prompt means no memo can ever match it
// (12 Oct 2026: the review ask's contact details). A prompt should carry no clock time: fix it at the source, not in the key. -> [part name]
const CLOCK = /\b\d{1,2}:\d\d\b|\b\d{4}-\d\d-\d\d\b/;
export function volatileParts(params = {}) {
  const names = [];
  walkParts(params, (name, text) => { if (CLOCK.test(normalise(String(text))) && /^(system|user|assistant)/.test(name)) names.push(name.replace(/#\d+$/, '')); });
  return [...new Set(names)];
}
// The hash of each line of every <tag> section of the system blocks and the user message: {"system:1:profile": [hash, ...]}, kept beside the answer (hashes only), so a miss can say WHICH LINE of a
// section differs from the live ask (12 Oct 2026: a profile block differed and nothing said where).
export function memoLines(params = {}) {
  const lines = {}, system = params.system ?? '', blocks = Array.isArray(system) ? system.map(block => block?.text ?? '') : [system];
  const section = (name, text) => { lines[name] = String(text).split('\n').map(piece); };
  blocks.forEach((text, i) => { for (const [, tag, inner] of text.matchAll(TAGGED)) section(`${Array.isArray(system) ? `system:${i}` : 'system'}:${tag}`, inner); });
  for (const message of params.messages ?? []) for (const [, tag, inner] of textOf(message.content).matchAll(TAGGED)) section(`${message.role}:${tag}`, inner);
  return lines;
}
// The kept ask nearest to this one (fewest differing parts), among the answers kept with their parts: -> the names of the parts that differ, or null when none was kept with parts.
// -> the names of the parts that differ, with, for a section whose line hashes were kept, the lines that differ ("system:1:profile (lines 33-34)"); or null.
export function nearestDiffers(parts, kept, lines = {}) {
  let best = null, bestKey = '';
  for (const [name, other] of Object.entries(kept)) {
    if (!name.endsWith(PARTS)) continue;
    const names = new Set([...Object.keys(parts), ...Object.keys(other)]), differs = [...names].filter(part => parts[part] !== other[part]);
    if (!best || differs.length < best.length) { best = differs; bestKey = name.slice(0, -PARTS.length); }
  }
  if (!best) return null;
  const was = kept[bestKey + LINES] || {};
  return best.map(part => {
    const mine = lines[part], theirs = was[part];
    if (!mine || !theirs) return part;
    const changed = []; for (let at = 0; at < Math.max(mine.length, theirs.length); at++) if (mine[at] !== theirs[at]) changed.push(at + 1);
    return changed.length ? `${part} (lines ${changed.length > 3 ? `${changed[0]}-${changed.at(-1)}, ${changed.length} in all` : changed.join(', ')} of ${mine.length})` : part;
  });
}
const PARTS = '#parts', LINES = '#lines', VOLATILE = '#volatile', MS = '#ms';

const insideRealData = file => (path.resolve(file) + path.sep).startsWith(path.join(os.homedir(), 'Library', 'Application Support', 'Job Pilotto') + path.sep);

// -> the cache file for this process, or '' (no cache).
export function memoFile(env = process.env) {
  const file = env.JOB_PILOTTO_E2E ? String(env.JOB_PILOTTO_MODEL_MEMO || '') : '';
  return file && !insideRealData(file) ? file : '';
}

// Memo-only (an offline row replay, e2e/lib/offline-app.mjs): a miss is refused, never asked: the plan's claude -p carries the signed-in account (11 Oct 2026:
// a form answer guessed the owner's name from it), so an offline replay answers only what the live run already asked.
export const memoOnly = (env = process.env) => !!env.JOB_PILOTTO_E2E && env.JOB_PILOTTO_MODEL_MEMO_ONLY === '1';

// Loose lookup (owner, 12 Oct 2026): the CI replay of a row case (e2e/lib/row-case-run.mjs) and `npm run row --loose` serve a kept answer whose USER-message parts and output schema match although the system side
// (instructions, profile, search, knowledge) or the model changed since the capture: a prompt or seed change would otherwise turn every row case's answer asks cold, and CI has no claude -p. Each such hit is
// appended to the file named by JOB_PILOTTO_MODEL_MEMO_LOOSE (e2e only) with the parts that differ. A changed job / form_fields block is still a miss.
// JOB_PILOTTO_MODEL_MEMO_MISSLOG=<file> (e2e only): each memo-only miss as a JSON line {differs, volatile}, whole (a log line is cut at its length: "differs in use) {"). Read by the row replay.
// JOB_PILOTTO_MODEL_MEMO_LATENCY=1 (e2e only): a replay serves a kept answer after the time the live ask took (recorded as `<key>#ms`, at most LATENCY_CAP_MS): the extension's concurrent flows (a popup dismissed
// while the page-kind ask is out, a widget reacting to the upload) then interleave as they did live, not by how fast this machine answers (12 Oct 2026: a row case green on a Mac, red on the Linux runner).
export const latencyOn = (env = process.env) => !!env.JOB_PILOTTO_E2E && env.JOB_PILOTTO_MODEL_MEMO_LATENCY === '1';
export const LATENCY_CAP_MS = 8000;
// JOB_PILOTTO_MODEL_MEMO_LATENCY_SCALE / _PAD_MS (e2e only): a slowed replay (row-to-case's second speed): every kept answer takes SCALE times as long and PAD ms more, also one with no recorded time.
const later = (ms, env) => { const wait = Math.min(LATENCY_CAP_MS, Math.max(0, ms || 0) * (Number(env.JOB_PILOTTO_MODEL_MEMO_LATENCY_SCALE) || 1)) + (Number(env.JOB_PILOTTO_MODEL_MEMO_LATENCY_PAD_MS) || 0); return wait > 0 ? new Promise(resolve => setTimeout(resolve, wait)) : null; };
export const missLogFile = (env = process.env) => (env.JOB_PILOTTO_E2E ? String(env.JOB_PILOTTO_MODEL_MEMO_MISSLOG || '') : '');
export const looseFile = (env = process.env) => (env.JOB_PILOTTO_E2E ? String(env.JOB_PILOTTO_MODEL_MEMO_LOOSE || '') : '');
const isPageSide = name => name === 'output' || /^(user|assistant):/.test(name);
export function looseMatch(parts, kept) {
  const mine = Object.entries(parts).filter(([name]) => isPageSide(name));
  let found = null;
  for (const [name, other] of Object.entries(kept)) {
    if (!name.endsWith(PARTS)) continue;
    const theirs = Object.entries(other).filter(([part]) => isPageSide(part));
    if (mine.length !== theirs.length || !mine.every(([part, hash]) => other[part] === hash)) continue;
    found = {key: name.slice(0, -PARTS.length), differs: [...new Set([...Object.keys(parts), ...Object.keys(other)])].filter(part => parts[part] !== other[part])};
  }
  return found;
}

const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };

// Wraps the client's messages.create in place (the adapter keeps its engine, billing, fallback). A failed ask is not kept. -> the same client.
export function withMemo(client, file = memoFile(), {only = memoOnly(), loose = looseFile(), missLog = missLogFile(), latency = latencyOn(), env = process.env} = {}) {
  if (!client || !file) return client;
  const ask = client.messages.create.bind(client.messages);
  client.messages = {...client.messages, create: async params => {
    const key = memoKey(params), kept = read(file);
    // An offline replay serves the page scrubbed (lib/live-capture.js fakeContacts): the answer the AI gave to the live page is scrubbed the same way, so an address it
    // read off the page (apply_email) is still on the replayed page.
    if (kept[key]) { if (only && latency) await later(Number(kept[key + MS]), env); return only ? JSON.parse(fakeContacts(JSON.stringify(kept[key]))) : kept[key]; }
    if (only && loose) {
      const hit = looseMatch(memoParts(params), kept);
      if (hit) {
        try { fs.appendFileSync(loose, `${JSON.stringify({differs: hit.differs})}\n`); } catch { /* the count is a report only */ }
        if (latency) await later(Number(kept[hit.key + MS]), env);
        return JSON.parse(fakeContacts(JSON.stringify(kept[hit.key])));
      }
    }
    if (only) {
      // JOB_PILOTTO_MODEL_MEMO_MISSES=<file> (e2e only): the normalised request of each miss, to see what differs from the live run's ask.
      if (process.env.JOB_PILOTTO_E2E && process.env.JOB_PILOTTO_MODEL_MEMO_MISSES) try { fs.appendFileSync(process.env.JOB_PILOTTO_MODEL_MEMO_MISSES, `${normalise(JSON.stringify({model: params.model, system: params.system ?? '', messages: params.messages ?? [], output_config: params.output_config ?? null, tools: params.tools ?? null}))}\n`); } catch { /* a debug aid */ }
      const differs = nearestDiffers(memoParts(params), kept, memoLines(params)), volatile = volatileParts(params);
      if (missLog) try { fs.appendFileSync(missLog, `${JSON.stringify({differs: differs || [], volatile})}\n`); } catch { /* a report only */ }
      throw new Error(`model memo: not in the row's kept answers (an offline replay never asks the model)${differs ? `; the nearest kept ask differs in: ${differs.join(', ') || 'nothing I can see (the same parts)'}` : ''}${volatile.length ? `; a clock time or date in ${volatile.join(', ')} can never match` : ''}`);
    }
    const askedAt = Date.now(), answer = await ask(params), tookMs = Date.now() - askedAt;
    try {
      fs.mkdirSync(path.dirname(file), {recursive: true});
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({...read(file), [key]: answer, [key + PARTS]: memoParts(params), [key + LINES]: memoLines(params), [key + MS]: tookMs, ...(volatileParts(params).length ? {[key + VOLATILE]: volatileParts(params)} : {})}));
      fs.renameSync(tmp, file);
    } catch { /* the cache is only a speed-up */ }
    return answer;
  }};
  return client;
}
