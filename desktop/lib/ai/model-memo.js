// The model-call cache of the e2e harness (spec: speed-5x landing 1, owner 11 Oct 2026): a live pool run keeps each answer the model gave, keyed by a hash of the
// request with its volatile parts normalised, so an offline replay of that run gets the same answers at once and asks the model only for what really changed.
// It exists only under the e2e env (JOB_PILOTTO_E2E and JOB_PILOTTO_MODEL_MEMO=<file>): the person's app never memoizes, and never into the app's own folder.
// The file holds the hash and the answer, never the request text. Wired in one place: lib/ai/index.js client(). Guard: desktop/test/model-memo.test.js.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Volatile parts of a request: an address's query or fragment, a timestamp, a uuid, a long hex id, a run of 6+ digits (an epoch, a job id in a path).
// Short numbers stay (a field id, a count, the digest's [n]); the order of everything stays (a numbered list's number is the answer).
const NORMALISE = [
  [/(https?:\/\/[^\s"'<>?#\\]+)[?#][^\s"'<>\\]*/g, '$1'],
  [/\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:?\d\d)?/g, '<time>'],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>'],
  [/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{16,}\b/gi, '<hex>'],
  [/\d{6,}/g, '<n>'],
];
export const normalise = text => NORMALISE.reduce((out, [pattern, to]) => out.replace(pattern, to), text);

// The request as the model sees it: model, system, messages, output schema, tools (max_tokens and the like do not change the answer's meaning).
export function memoKey(params = {}) {
  const asked = {model: params.model, system: params.system ?? '', messages: params.messages ?? [], output_config: params.output_config ?? null, tools: params.tools ?? null};
  return crypto.createHash('sha256').update(normalise(JSON.stringify(asked))).digest('hex');
}

const insideRealData = file => (path.resolve(file) + path.sep).startsWith(path.join(os.homedir(), 'Library', 'Application Support', 'Job Pilotto') + path.sep);

// -> the cache file for this process, or '' (no cache).
export function memoFile(env = process.env) {
  const file = env.JOB_PILOTTO_E2E ? String(env.JOB_PILOTTO_MODEL_MEMO || '') : '';
  return file && !insideRealData(file) ? file : '';
}

const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };

// Wraps the client's messages.create in place (the adapter keeps its engine, billing, fallback). A failed ask is not kept. -> the same client.
export function withMemo(client, file = memoFile()) {
  if (!client || !file) return client;
  const ask = client.messages.create.bind(client.messages);
  client.messages = {...client.messages, create: async params => {
    const key = memoKey(params), kept = read(file);
    if (kept[key]) return kept[key];
    const answer = await ask(params);
    try {
      fs.mkdirSync(path.dirname(file), {recursive: true});
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({...read(file), [key]: answer}));
      fs.renameSync(tmp, file);
    } catch { /* the cache is only a speed-up */ }
    return answer;
  }};
  return client;
}
