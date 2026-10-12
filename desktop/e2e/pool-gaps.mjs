// node pool-gaps.mjs <smoke reports folder>...: the gaps between progress notes on CI pool rows (lib/pool-gaps.mjs), the numbers the silent dead-end rule's T is chosen from
// (spec docs/superpowers/specs/2026-10-12-one-next-move.md, phase 2 box 2). One folder per downloaded run (gh run download <id> --name pool-smoke-<id>); reads the latest day
// report and each row's app log; prints the quantiles, one line per row (slowest gap, its tail, its ending), slowest first, then the dead-end detector at each candidate T (recall on
// rows stopped before the form, false fires on rows that reached it: phase 2 box 3). Reads only: never sends anything.
import fs from 'node:fs';
import path from 'node:path';
import {appLogName, detectorAt, gapRows, gapSummary} from './lib/pool-gaps.mjs';
import {STILL_SECONDS} from './lib/live-still.mjs';

const read = file => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };
const s = ms => (ms == null ? '-' : (ms / 1000).toFixed(1));
const rows = [], runs = [];
for (const dir of process.argv.slice(2)) {
  const days = (() => { try { return fs.readdirSync(dir).filter(name => /^\d{4}-\d\d-\d\d\.json$/.test(name)).sort(); } catch { return []; } })();
  if (!days.length) { console.log(`${dir}: no day report`); continue; }
  const report = JSON.parse(read(path.join(dir, days.at(-1))) || '{}'), day = report.day || days.at(-1).slice(0, 10);
  const logs = Object.fromEntries(Object.keys(report.results || {}).map(row => [row, read(path.join(dir, appLogName(day, row)))]));
  rows.push(...gapRows(report, logs).map(row => ({...row, run: path.basename(path.resolve(dir, '..'))})));
  runs.push({report, logs});
}
const sum = gapSummary(rows);
console.log(`rows ${sum.measured} measured (${sum.notMeasured} without progress notes), gaps ${sum.gaps}: p50 ${s(sum.p50)} s, p90 ${s(sum.p90)} s, p95 ${s(sum.p95)} s, p99 ${s(sum.p99)} s, max ${s(sum.max)} s; slowest on rows that reached the form ${s(sum.maxReady)} s`);
// The pool ends a row after STILL_SECONDS of total quiet (lib/live-still.mjs): a stall with nothing happening is cut there, so a gap or tail above it is activity without progress.
console.log(`censored: a fully quiet stall is cut by the pool at ${STILL_SECONDS} s (lib/live-still.mjs); above ${STILL_SECONDS} s the pool measures activity without progress only`);
for (const row of rows.filter(row => row.measured).sort((a, b) => b.maxGapMs - a.maxGapMs)) {
  const slowest = row.gaps.reduce((top, gap) => (gap.ms > (top?.ms ?? -1) ? gap : top), null);
  console.log(`${s(row.maxGapMs).padStart(6)} s slowest (then ${slowest?.kind || '-'}) · ${String(row.events).padStart(3)} notes · tail ${s(row.tailMs).padStart(6)} s · ${(row.ending || '-').padEnd(12)} ${row.deadEnd ? 'door' : '    '} ${row.silent ? `silent x${row.silent}` : '         '} · ${row.run} · ${row.row}`);
}
// The detector at each candidate T, summed over the runs: the same rule the extension runs (ladder/silence.js), applied to the logs.
for (const T of [15000, 20000, 30000, 45000, 60000]) {
  const all = runs.map(run => detectorAt(run.report, run.logs, T, STILL_SECONDS * 1000));
  const sum = key => all.reduce((n, one) => n + one[key], 0), list = key => all.flatMap(one => one[key]);
  console.log(`T ${T / 1000} s: recall ${sum('detected')}/${sum('stopped')} (silent rule alone ${sum('silentOnly')}), missed ${list('missed').length} (cut by the pool while silent ${sum('censored')}), false fires ${list('falseFires').length}/${sum('reached')}${list('falseFires').length ? `: ${list('falseFires').join(', ')}` : ''}`);
}
