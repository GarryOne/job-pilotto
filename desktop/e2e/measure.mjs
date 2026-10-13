// npm run measure -- [--days N] [--every] [--root <captures>] [--old <extension dir>] [--compare] [--out <dir>]: the pool's numbers for THIS build, offline, on the
// captures library (lib/capture-library.mjs): each row's newest capture of the last N days (default 1) replayed by lib/row-replay.mjs (unchanged), read as a live row is
// (lib/measure.mjs: parseLive, the ending, the shadow / acted / person tables). Nothing reaches a site, no site limit is used, $0: the kept answers only (memo); an ask the capture
// never made is a miss, and a row with any miss is NOT MEASURED, the step and the differing part named (a prompt change shows at once) (an --ask through the plan's claude -p, capped, is a later step of the spec).
// --compare: the captures' own live numbers, in their own table. Every line is labelled offline (memo|plan) and "unverified" until the positive control passed (spec PR 3).
// A fix is proven only by a live run (Pool-row / live-proof): these numbers decide what to try. Spec docs/superpowers/specs/2026-10-13-capture-once-measure-many.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {capturesRoot} from './lib/capture-library.mjs';
import {capturesOf, measuredRow, offlineLabel, tableLines, tablesOf} from './lib/measure.mjs';
import {replayRows, staleCapture} from './lib/row-replay.mjs';
import {slug} from './lib/replay-candidate.mjs';

const args = process.argv.slice(2), flag = name => { const at = args.indexOf(`--${name}`); return at >= 0 ? args[at + 1] : ''; }, has = name => args.includes(`--${name}`);
const root = path.resolve(flag('root') || capturesRoot());
const dirs = capturesOf(root, {days: Number(flag('days')) || 1, every: has('every')});
const stale = dirs.filter(dir => staleCapture(dir));
for (const dir of stale) console.log(`measure: ${path.basename(dir)}: STALE, not measured: ${staleCapture(dir)}`);
const todo = dirs.filter(dir => !stale.includes(dir));
if (!todo.length) { console.error(`measure: no capture to measure in ${root} (npm run captures -- pull, or a live row first)`); process.exit(2); }
const label = offlineLabel();
console.log(`measure: ${todo.length} captures, ${label}; nothing reaches a site`);
const started = Date.now();
const results = await replayRows(todo, {extensionDir: flag('old') ? path.resolve(flag('old')) : undefined});
const rows = todo.map((dir, at) => measuredRow(dir, results[at]));
for (const row of rows) if (row.offline) console.log(`[${label}] ${row.row}: ${row.offline.misses ? `${row.offline.misses} asks with no kept answer` : 'every ask had its kept answer'}${row.offline.divergence ? `, diverged: ${row.offline.divergence}` : ''}${row.offline.unrecorded.length ? `, ${row.offline.unrecorded.length} addresses not recorded` : ''}`);
for (const line of tableLines(tablesOf(rows, 'offline'), label)) console.log(line);
if (has('compare')) {   // the positive control's other side: the captures' own app logs, read the same way, in their own table
  const builds = [...new Set(rows.map(row => `${String(row.build.commit || '?').slice(0, 9)} (ext ${row.build.extension || '?'})`))];
  for (const line of tableLines(tablesOf(rows, 'live'), `live, captured on ${builds.join(', ')}`)) console.log(line);
}
// The same files a live pool run leaves (<day>.json + <day>-<row>.app.log), so pool-shadow.mjs / pool-acted.mjs read them too, labelled by the folder's name.
const out = path.resolve(flag('out') || fs.mkdtempSync(path.join(os.tmpdir(), 'jp-measure-')));
const day = new Date().toISOString().slice(0, 10), report = {label, results: {}};
fs.mkdirSync(out, {recursive: true});
for (const row of rows.filter(one => one.measured)) {
  report.results[row.row] = {...row.offline.result, ending: row.offline.ending, offline: label};
  fs.writeFileSync(path.join(out, `${day}-${slug(row.row)}.app.log`), row.offline.log);
}
fs.writeFileSync(path.join(out, `${day}.json`), `${JSON.stringify(report, null, 1)}\n`);
console.log(`measure: ${rows.filter(row => row.measured).length} of ${rows.length} rows measured in ${Math.round((Date.now() - started) / 1000)} s; ${label}; report in ${out}`);
