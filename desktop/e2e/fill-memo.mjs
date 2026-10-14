// Fills the model answers a recording lacks (a fix changed what the app asks): replays the row's network record on this Mac with the plan's claude -p for the missed asks only
// and merges the new answers into the record's model-memo.json (replay-net.mjs --fill-memo, lib/fill-memo.mjs); then replays it again WITHOUT asking to prove it is faithful.
//   node fill-memo.mjs <records dir> "<row>" [--out <dir>]      (npm run fill-memo -- <records dir> "<row>"; publish after: node records-publish.mjs <records dir>)
// Cost: the plan path, about $0.06 a row asked, once per changed ask; never CI, never an API key. Guard: e2e/test/fill-memo.test.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {newestPerRow} from './replay-records.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const [root, name] = process.argv.slice(2).filter(arg => !arg.startsWith('--')), at = process.argv.indexOf('--out');
if (!root || !name) { console.error('usage: node fill-memo.mjs <records dir> "<row>" [--out <dir>]'); process.exit(2); }
if (process.env.CI) { console.error('fill-memo: the plan\'s claude -p, a Mac only, never CI'); process.exit(2); }
const row = newestPerRow(root).find(one => one.name === name);
if (!row) { console.error(`fill-memo: no record of "${name}" in ${root}`); process.exit(2); }
const out = at > 0 ? process.argv[at + 1] : fs.mkdtempSync(path.join(os.tmpdir(), 'jp-fill-memo-'));
const replay = flags => { const work = path.join(out, flags.length ? 'fill' : 'check'); spawnSync(process.execPath, [path.join(here, 'replay-net.mjs'), row.dir, work, ...flags], {stdio: ['ignore', 'inherit', 'inherit']}); try { return JSON.parse(fs.readFileSync(path.join(work, 'replay.json'), 'utf8')); } catch { return null; } };
const line = (label, result) => console.log(`fill-memo: ${name} ${label}: ${result ? `${result.liveHit}/${result.liveAsks} live asks answered, ${result.misses} extra, outcome ${result.outcome?.reached} ${result.outcome?.filled}/${result.outcome?.left}${result.filled != null ? `, ${result.filled} answer(s) filled` : ''}${result.tripped ? `, TRIPPED: ${result.tripped}` : ''}` : 'no result'}`);
console.log(`fill-memo: ${name}: filling (plan path, about $0.06 per ask answered; the network is replayed, no site visit)`);
const filled = replay(['--fill-memo']);
line('filled', filled);
if (!filled || filled.tripped) process.exit(1);
line('check (no model)', replay([]));
console.log(`fill-memo: next: node ${path.join(here, 'records-publish.mjs')} ${root}`);
