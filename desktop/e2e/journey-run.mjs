// Replays each journey of journeys.json from the newest record of its row and judges the card and the panel at every step (journey.mjs): the PR check for flow changes.
//   node journey-run.mjs <records dir> <out dir> [--only=<row name>]     exit 1 when a journey fails or has no record. Guard: e2e/test/journey-run.test.mjs.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {newestPerRow} from './replay-records.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const journeyRows = (file = path.join(here, 'journeys.json')) => JSON.parse(fs.readFileSync(file, 'utf8')).rows;
// rows: journeys.json rows; found: newestPerRow's [{name, dir}] -> [{row, why, dir}] and the rows with no record
export function plan(rows, found, only = '') {
  const picked = rows.filter(one => (!only || one.row === only) && !one.pending);
  return {pending: rows.filter(one => one.pending && (!only || one.row === only)), run: picked.flatMap(one => { const hit = found.find(row => row.name === one.row); return hit ? [{...one, dir: hit.dir}] : []; }),
    missing: picked.filter(one => !found.some(row => row.name === one.row)).map(one => one.row)};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [recordsDir, out] = process.argv.slice(2), only = (process.argv.find(arg => arg.startsWith('--only=')) || '').slice(7);
  if (!recordsDir || !out) { console.error('usage: node journey-run.mjs <records dir> <out dir> [--only=<row>]'); process.exit(2); }
  const {run, missing, pending} = plan(journeyRows(), newestPerRow(recordsDir), only);
  let failed = missing.length;
  for (const one of pending) console.log(`journey-run: PENDING ${one.row}: ${one.pending}`);   // said every run, never silent
  for (const row of missing) console.log(`journey-run: FAIL ${row}: no record of this row (a journey with nothing to replay is red, never skipped)`);
  for (const one of run) {
    const slug = one.row.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    console.log(`journey-run: ${one.row} (${one.why})`);
    const ran = spawnSync(process.execPath, [path.join(here, 'journey.mjs'), one.dir, path.join(out, slug), '--cpu=4'], {stdio: 'inherit'});
    if (ran.status !== 0) { failed++; console.log(`journey-run: FAIL ${one.row} (exit ${ran.status})`); }
  }
  console.log(`journey-run: ${failed ? `${failed} FAILED` : 'all passed'} of ${run.length + missing.length}`);
  process.exit(failed ? 1 : 0);
}
