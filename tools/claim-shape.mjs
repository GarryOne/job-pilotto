#!/usr/bin/env node
// A claim per pool row, so parallel /fix-failing-forms sessions never take the same shape (owner, 11 Oct 2026). One file per row in the Mac's QA folder
// (~/Library/Application Support/Job Pilotto QA/claims/<slug>.json: session, start time); created with O_EXCL, so of many sessions asking at once exactly one wins.
// A claim is stale (anyone may take it over) when it is older than TTL_MS or its session is not in the `--alive` list the skill passes from ListAgents.
// The same tool holds the other locks by fixed name: "e2e-page" (the shared Notion test page, --ttl 30) and "flow-core" (--ttl 180); the holder renews by claiming again.
// Usage: node tools/claim-shape.mjs claim "<row name>" --session <me> [--alive a,b,c] [--ttl <minutes>]   exit 0 = yours, exit 1 = held (prints the holder)
//        node tools/claim-shape.mjs release "<row name>" --session <me>   |   node tools/claim-shape.mjs list [--alive a,b,c]
// Guard: desktop/test/claim-shape.test.js (it uses a temp folder, never the real one).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const TTL_MS = 6 * 60 * 60 * 1000;
export const CLAIMS = path.join(os.homedir(), 'Library', 'Application Support', 'Job Pilotto QA', 'claims');
export const slug = name => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
const fileOf = (dir, name) => path.join(dir, `${slug(name)}.json`);
const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const stale = (held, now, alive) => !held || now - held.at > (held.ttl || TTL_MS) || (Array.isArray(alive) && !alive.includes(held.session));

// -> {ok: true} | {ok: false, holder, since}
export function claim(name, session, {dir = CLAIMS, now = Date.now(), alive, ttl = 0} = {}) {   // ttl (ms): a shorter life for a lock held only while something runs ("e2e-page", 30 min, renewed by the holder)
  if (!slug(name) || !session) return {ok: false, holder: '', error: 'a row name and a session are needed'};
  fs.mkdirSync(dir, {recursive: true});
  const file = fileOf(dir, name), body = JSON.stringify({name, session, at: now, ...(ttl ? {ttl} : {})});
  for (let attempt = 0; attempt < 3; attempt++) {
    try { fs.writeFileSync(file, body, {flag: 'wx'}); return {ok: true}; } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const held = read(file);
    if (held?.session === session) { fs.writeFileSync(file, body); return {ok: true}; }   // the holder renews
    if (!stale(held, now, alive)) return {ok: false, holder: held.session, since: held.at};
    try { fs.unlinkSync(file); } catch { /* another taker removed it first: try to create again */ }
  }
  return {ok: false, holder: read(file)?.session || '', since: read(file)?.at};
}

export function release(name, session, {dir = CLAIMS} = {}) {
  const file = fileOf(dir, name), held = read(file);
  if (!held) return {ok: true};
  if (held.session !== session) return {ok: false, holder: held.session};
  fs.unlinkSync(file);
  return {ok: true};
}

export function list({dir = CLAIMS, now = Date.now(), alive} = {}) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(file => file.endsWith('.json')).map(file => read(path.join(dir, file))).filter(held => held && !stale(held, now, alive));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, name] = process.argv.slice(2), flag = key => { const at = process.argv.indexOf(key); return at > 0 ? process.argv[at + 1] : ''; };
  const session = flag('--session'), alive = flag('--alive') ? flag('--alive').split(',').map(text => text.trim()).filter(Boolean) : undefined;
  if (command === 'list') { for (const held of list({alive})) console.log(`${held.session}\t${held.name}\t${new Date(held.at).toISOString()}`); process.exit(0); }
  const result = command === 'claim' ? claim(name, session, {alive, ttl: (Number(flag('--ttl')) || 0) * 60000}) : command === 'release' ? release(name, session) : {ok: false, error: 'usage: claim|release "<row name>" --session <me> | list'};
  if (!result.ok) { console.error(result.error || `held by ${result.holder}${result.since ? ` since ${new Date(result.since).toISOString()}` : ''}`); process.exit(1); }
  console.log('ok');
}
