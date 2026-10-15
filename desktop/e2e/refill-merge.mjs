// The publish job's first step: each row's refilled memo (a pack from refill-pack.mjs, opened with NET_RECORD_KEY as a base64 PEM) is merged into the FRESH record of the row (a new answer
// only, never a changed or removed one: lib/fill-memo.mjs keepFilled, oldKeysKept asserts it) and the row's folder is copied to <staged dir>, the folder records-publish.mjs publishes.
//   node refill-merge.mjs <records dir> <packs dir> <staged dir>   -> prints a markdown table; exit 1 when an old key was lost
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {newestPerRow} from './replay-records.mjs';
import {keepFilled, oldKeysKept} from './lib/fill-memo.mjs';

const [root, packs, staged] = process.argv.slice(2);
if (!root || !packs || !staged) { console.error('usage: node refill-merge.mjs <records dir> <packs dir> <staged dir>'); process.exit(2); }
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-refill-merge-')), pem = path.join(work, 'key.pem');
fs.writeFileSync(pem, Buffer.from(process.env.NET_RECORD_KEY || '', 'base64'), {mode: 0o600});
const rows = new Map(newestPerRow(root).map(row => [row.name, row])), table = [];
let bad = 0;
try {
  for (const dir of fs.readdirSync(packs, {withFileTypes: true}).filter(entry => entry.isDirectory()).map(entry => path.join(packs, entry.name))) {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')), row = rows.get(meta.name);
    if (!row) { console.error(`refill-merge: no record of "${meta.name}"`); bad++; continue; }
    const key = path.join(work, 'k'), out = path.join(work, 'out'), file = path.join(row.dir, 'model-memo.json');
    fs.mkdirSync(out, {recursive: true});
    execFileSync('openssl', ['pkeyutl', '-decrypt', '-inkey', pem, '-pkeyopt', 'rsa_padding_mode:oaep', '-in', path.join(dir, 'k.enc'), '-out', key]);
    execFileSync('openssl', ['enc', '-d', '-aes-256-cbc', '-pbkdf2', '-in', path.join(dir, 'memo.enc'), '-out', path.join(out, 'model-memo.json'), '-pass', `file:${key}`]);
    const before = (() => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } })(), fresh = keepFilled(row.dir, out), after = JSON.parse(fs.readFileSync(file, 'utf8')), lost = oldKeysKept(before, after);
    if (lost.length) { console.error(`refill-merge: ${meta.name}: ${lost.length} old key(s) lost or changed: refused`); bad++; continue; }
    fs.cpSync(row.dir, path.join(staged, path.basename(row.dir)), {recursive: true});
    table.push(`| ${meta.name} | ${fresh.length} | 0 | $${Number(meta.usd).toFixed(4)} |`);
  }
} finally { fs.rmSync(work, {recursive: true, force: true}); }
console.log(['| Row | New answers | Old keys lost | Spent |', '|---|---|---|---|', ...table].join('\n'));
process.exit(bad ? 1 : 0);
