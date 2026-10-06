// What an e2e suite spends on AI, counted from the API's own usage figures, and the answers it can replay instead of paying again (7 Oct 2026: the e2e key billed
// $11.67 on 6 Oct, /ai-cost showed $1.12 of it: only the screenshot review reported; the app under test and the judges spent the rest unseen).
//   app:    every call the app under test makes, as the AI proxy (lib/ai-proxy.mjs) forwards it
//   judges: every call test code makes through lib/model.mjs on the API engine (judge, factjudge, fit)
// Replay (CI): the proxy keeps each paid answer under a hash of its request in E2E_AI_CACHE; with E2E_AI_REPLAY=1 an identical request is answered from there, at no
// cost. Only the scheduled runs ask the model live (e2e.yml); a request seen for the first time always goes to the model and is kept for next time.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {usageCost} from './vision.mjs';

const blank = () => ({calls: 0, usd: 0, unpriced: 0, replayed: 0, saved: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0});
let tally = {app: blank(), judges: blank()};
export const usage = () => tally;
export const resetUsage = () => { tally = {app: blank(), judges: blank()}; };

// "claude-haiku-4-5-20251001" -> "claude-haiku-4-5": the API answers with the dated id, the price list has the alias.
export const priceName = model => String(model || '').replace(/-\d{8}$/, '');
const cost = (model, used) => usageCost(priceName(model), used);

// {model, usage} out of a Messages answer: a JSON body, or a stream (message_start carries the model and input, message_delta the final output count).
export function usageOf(text, contentType = '') {
  if (!/event-stream/.test(contentType)) { try { const data = JSON.parse(text); return data?.usage ? {model: data.model, usage: data.usage} : null; } catch { return null; } }
  let model = '', used = null;
  for (const line of String(text).split('\n')) {
    if (!line.startsWith('data:')) continue;
    let event; try { event = JSON.parse(line.slice(5)); } catch { continue; }
    if (event.type === 'message_start') { model = event.message?.model || ''; used = {...event.message?.usage}; }
    if (event.type === 'message_delta' && event.usage) used = {...used, ...Object.fromEntries(Object.entries(event.usage).filter(([, n]) => n != null))};
  }
  return used ? {model, usage: used} : null;
}

// One paid call. An unknown model is counted, not priced (its cost is never guessed).
export function count(kind, found) {
  if (!found) return;
  const row = tally[kind], u = found.usage || {}, usd = cost(found.model, u);
  row.calls++;
  if (usd == null) row.unpriced++; else row.usd += usd;
  row.input += Number(u.input_tokens) || 0; row.output += Number(u.output_tokens) || 0;
  row.cacheRead += Number(u.cache_read_input_tokens) || 0; row.cacheWrite += Number(u.cache_creation_input_tokens) || 0;
}
// One call answered from the replay cache: free; `saved` is what it would have cost.
export function countReplay(kind, found) {
  const row = tally[kind];
  row.replayed++;
  row.saved += (found && cost(found.model, found.usage)) || 0;
}

// The key of a request: the path and the body without the fields that change on every call but not the answer.
export function requestKey(url, body) {
  let data;
  try { data = JSON.parse(body.toString('utf8') || '{}'); } catch { data = {raw: body.toString('base64')}; }
  delete data.metadata;
  return crypto.createHash('sha256').update(`${url}\n${JSON.stringify(data)}`).digest('hex').slice(0, 32);
}

const cacheDir = (env = process.env) => env.E2E_AI_CACHE || '';
export const replaying = (env = process.env) => env.E2E_AI_REPLAY === '1' && !!cacheDir(env);

// -> {status, contentType, body: Buffer} kept for this request, or null.
export function recall(key, env = process.env) {
  if (!replaying(env)) return null;
  try {
    const file = path.join(cacheDir(env), `${key}.json`), kept = JSON.parse(fs.readFileSync(file, 'utf8'));
    try { const now = new Date(); fs.utimesSync(file, now, now); } catch {}   // still in use: the workflow drops answers untouched for a week
    return {status: kept.status, contentType: kept.contentType, body: Buffer.from(kept.body, 'base64')};
  } catch { return null; }
}
// Keep a successful answer (CI only: E2E_AI_CACHE is set by the workflow; a Mac never records).
export function keep(key, {status, contentType, body}, env = process.env) {
  const dir = cacheDir(env);
  if (!dir || status !== 200) return;
  try { fs.mkdirSync(dir, {recursive: true}); fs.writeFileSync(path.join(dir, `${key}.json`), JSON.stringify({status, contentType, body: Buffer.from(body).toString('base64')})); } catch {}
}

// The suite's figures, one file per kind, in the shape ai-cost-report.mjs --file reads ({usd, calls}); the rest is for the log and the artifact.
export function writeUsage(dir) {
  const lines = [];
  for (const [kind, row] of Object.entries(tally)) {
    if (!row.calls && !row.replayed) continue;
    fs.writeFileSync(path.join(dir, `ai-usage-${kind}.json`), JSON.stringify({...row, usd: Math.round(row.usd * 1e6) / 1e6, saved: Math.round(row.saved * 1e6) / 1e6}, null, 1));
    lines.push(`AI ${kind}: ${row.calls} paid call(s) $${row.usd.toFixed(4)}${row.unpriced ? ` (+${row.unpriced} unpriced)` : ''}, ${row.replayed} replayed (saved $${row.saved.toFixed(4)})`);
  }
  if (lines.length) console.log(`  ${lines.join('\n  ')}`);
}
