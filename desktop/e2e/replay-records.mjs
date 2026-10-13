// Replays every pool row's newest network record offline on this build (replay-net.mjs, one row after another) and writes one "Replay vs live" record per row
// for desktop/e2e/fidelity-report.mjs, plus a Markdown summary on stdout. CI: .github/workflows/replay-offline.yml. Guard: e2e/test/replay-records.test.mjs.
//   node replay-records.mjs <records dir> <out dir>   (<records dir>: unpacked net-records-<run> folders, each row a folder with record.json)
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const json = (file, fallback = null) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const slug = name => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

// The pool's rows by posting address (desktop/e2e/smoke-sites.json): a record made before the name was kept (13 Oct 2026) finds its row by the address it opened.
export const poolByUrl = (file = new URL('./smoke-sites.json', import.meta.url)) => new Map((json(file, {}).shapes || []).flatMap(site => (site.urls || []).map(url => [url, site.shape])));
const bare = url => String(url || '').split('#')[0];

// The newest record of each row, by its name (an older record: its pool row by address, else its posting host). -> [{name, dir, record}]
export function newestPerRow(root, byUrl = poolByUrl()) {
  const found = new Map();
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      if (!entry.isDirectory()) continue;
      const here = path.join(dir, entry.name), record = json(path.join(here, 'record.json'));
      if (!record) { walk(here); continue; }
      const name = record.name || byUrl.get(bare(record.url)) || new URL(record.url).host, old = found.get(name);
      if (!old || old.record.startMs < record.startMs) found.set(name, {name, dir: here, record});
    }
  };
  walk(root);
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// Where a record was made: its own word (live-row.mjs since 14 Oct 2026), else the folder the PR job unpacks the Mac's release into (records/mac/).
export const whereOf = (record, dir) => (['mac', 'ci'].includes(record.where) ? record.where : /(^|[\\/])mac([\\/]|$)/.test(dir) ? 'mac' : 'ci');

// The rows put aside on purpose, by name -> reason (desktop/e2e/replay-deferred.json, edited in a PR: the owner's call, 14 Oct 2026).
export const deferredRows = (file = new URL('./replay-deferred.json', import.meta.url)) => json(file, {}).rows || {};

// One row's replay -> its "Replay vs live" record (the shape /admin/applying reads: site/src/applying-fidelity.js).
export function fidelityRecord({name, dir = '', record}, replay, {sha = '', branch = '', at = new Date().toISOString(), deferred = {}} = {}) {
  const host = new URL(record.url).host.replace(/^www\./, '');
  const own = (replay?.counts?.notRecorded || []).filter(line => { try { return new URL(line.split(' ')[1]).host.endsWith(host); } catch { return false; } }).length;
  return {name, sha, branch, at, outcome: replay?.outcome || null, liveOutcome: replay?.liveOutcome || null, live: {asks: replay?.liveAsks ?? 0}, recording: {where: whereOf(record, dir), at: Number.isFinite(record.startMs) ? new Date(record.startMs).toISOString() : null}, deferred: deferred[name] || null,
    network: replay ? {hit: replay.liveHit, extra: replay.misses, notRecorded: own, orderMatched: replay.counts?.order || 0, echoed: replay.counts?.echoed || 0} : null};
}

// One row 100% the same as live: every live ask answered, no extra ask, no site request missing. The summary line: "N of M rows same as live".
export const isSame = row => !!(row.network && row.network.hit === row.live.asks && row.network.extra === 0 && row.network.notRecorded === 0);
export const sameAsLive = rows => rows.filter(isSame).length;

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [root, out] = process.argv.slice(2);
  if (!root || !out) { console.error('usage: node replay-records.mjs <records dir> <out dir>'); process.exit(2); }
  // JP_REPLAY_ONLY: row names, one a line (the gate's retry of the rows that came out worse).
  const only = new Set(String(process.env.JP_REPLAY_ONLY || '').split('\n').map(line => line.trim()).filter(Boolean));
  const here = path.dirname(new URL(import.meta.url).pathname), rows = newestPerRow(root).filter(row => !only.size || only.has(row.name)), records = [], deferred = deferredRows();
  fs.mkdirSync(path.join(out, 'step4'), {recursive: true});
  for (const row of rows) {
    const work = path.join(out, 'replays', slug(row.name));
    const ran = spawnSync(process.execPath, [path.join(here, 'replay-net.mjs'), row.dir, work], {encoding: 'utf8', timeout: 6 * 60 * 1000});
    const replay = json(path.join(work, 'replay.json'));
    if (!replay) console.error(`replay-records: ${row.name}: no result (${(ran.stderr || ran.error?.message || '').trim().split('\n').filter(line => /error|Error|throw/.test(line)).slice(-2).join(' | ').slice(0, 300)})`);
    const record = fidelityRecord(row, replay, {sha: process.env.GITHUB_SHA?.slice(0, 7) || '', branch: process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || '', deferred});
    records.push(record);
    if (record.network) fs.writeFileSync(path.join(out, 'step4', `${slug(row.name)}.json`), `${JSON.stringify(record, null, 1)}\n`);
  }
  console.log(`## Replay vs live: ${sameAsLive(records)} of ${records.length} rows same as live\n`);
  console.log('| Row | Live asks | Answered as live | Extra | Site requests not recorded |\n|---|---|---|---|---|');
  for (const row of records) console.log(`| ${row.name} | ${row.live.asks} | ${row.network ? row.network.hit : 'no result'} | ${row.network?.extra ?? '–'} | ${row.network?.notRecorded ?? '–'} |`);
}
