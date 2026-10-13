// Replays every pool row's newest network record offline on this build (replay-net.mjs, one row after another) and writes one "Replay vs live" record per row
// for desktop/e2e/fidelity-report.mjs, plus a Markdown summary on stdout. CI: .github/workflows/replay-offline.yml. Guard: e2e/test/replay-records.test.mjs.
//   node replay-records.mjs <records dir> <out dir>   (<records dir>: unpacked net-records-<run> folders, each row a folder with record.json)
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const json = (file, fallback = null) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const slug = name => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

// The newest record of each row, by its name (a record made before the name was kept goes by its posting host). -> [{name, dir, record}]
export function newestPerRow(root) {
  const found = new Map();
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      if (!entry.isDirectory()) continue;
      const here = path.join(dir, entry.name), record = json(path.join(here, 'record.json'));
      if (!record) { walk(here); continue; }
      const name = record.name || new URL(record.url).host, old = found.get(name);
      if (!old || old.record.startMs < record.startMs) found.set(name, {name, dir: here, record});
    }
  };
  walk(root);
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// One row's replay -> its "Replay vs live" record (the shape /admin/applying reads: site/src/applying-fidelity.js).
export function fidelityRecord({name, record}, replay, {sha = '', branch = '', at = new Date().toISOString()} = {}) {
  const host = new URL(record.url).host.replace(/^www\./, '');
  const own = (replay?.counts?.notRecorded || []).filter(line => { try { return new URL(line.split(' ')[1]).host.endsWith(host); } catch { return false; } }).length;
  return {name, sha, branch, at, live: {asks: replay?.liveAsks ?? 0},
    network: replay ? {hit: replay.liveHit, extra: replay.misses, notRecorded: own, orderMatched: replay.counts?.order || 0, echoed: replay.counts?.echoed || 0} : null};
}

// The summary line a PR reads: "N of M rows same as live".
export const sameAsLive = rows => rows.filter(row => row.network && row.network.hit === row.live.asks && row.network.extra === 0 && row.network.notRecorded === 0).length;

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [root, out] = process.argv.slice(2);
  if (!root || !out) { console.error('usage: node replay-records.mjs <records dir> <out dir>'); process.exit(2); }
  const here = path.dirname(new URL(import.meta.url).pathname), rows = newestPerRow(root), records = [];
  fs.mkdirSync(path.join(out, 'step4'), {recursive: true});
  for (const row of rows) {
    const work = path.join(out, 'replays', slug(row.name));
    const ran = spawnSync(process.execPath, [path.join(here, 'replay-net.mjs'), row.dir, work], {encoding: 'utf8', timeout: 6 * 60 * 1000});
    const replay = json(path.join(work, 'replay.json'));
    if (!replay) console.error(`replay-records: ${row.name}: no result (${(ran.stderr || ran.error?.message || '').trim().split('\n').filter(line => /error|Error|throw/.test(line)).slice(-2).join(' | ').slice(0, 300)})`);
    const record = fidelityRecord(row, replay, {sha: process.env.GITHUB_SHA?.slice(0, 7) || '', branch: process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || ''});
    records.push(record);
    if (record.network) fs.writeFileSync(path.join(out, 'step4', `${slug(row.name)}.json`), `${JSON.stringify(record, null, 1)}\n`);
  }
  console.log(`## Replay vs live: ${sameAsLive(records)} of ${records.length} rows same as live\n`);
  console.log('| Row | Live asks | Answered as live | Extra | Site requests not recorded |\n|---|---|---|---|---|');
  for (const row of records) console.log(`| ${row.name} | ${row.live.asks} | ${row.network ? row.network.hit : 'no result'} | ${row.network?.extra ?? '–'} | ${row.network?.notRecorded ?? '–'} |`);
}
