// What "Confirmed offline" will replay (owner, 14 Oct 2026; .github/workflows/fix-verdicts.yml): per landed fix, the row's newest recording made BEFORE the fix; per row whose newest
// recording got less far than an older one, the newest recording and the older one's build. A row without such a recording gets its verdict now ("Needs a recording"). Writes <out>:
// {jobs: [{kind, row, ...}], verdicts: [...]}. Run: node verify-plan.mjs <records dir> <out file>. Guard: e2e/test/verify-plan.test.mjs.
import fs from 'node:fs';
import {buildLedger} from './lib/fix-ledger.mjs';
import {poolByUrl} from './replay-records.mjs';
import {buildOf, compare} from './lib/verify-judge.mjs';
import {mainHistory, recordsByRow} from './lib/verify-records.mjs';

const MAX_JOBS = 20;   // macOS runners: five at once, ~12 minutes a row
// The folder is relative to the records folder: the row's own runner unpacks it elsewhere.
const strip = (record, history) => ({dir: record.rel ?? record.dir, at: record.at, build: buildOf({log: record.log, startMs: record.startMs, ...history})});

// -> {jobs, verdicts}. rows: recordsByRow(); ledger: buildLedger(); history: mainHistory().
export function plan({rows, ledger, history}) {
  const jobs = [], verdicts = [], landed = new Map();
  for (const fix of ledger) if (!landed.has(fix.site) || Date.parse(fix.landedAt) > Date.parse(landed.get(fix.site).landedAt)) landed.set(fix.site, fix);
  for (const [row, fix] of landed) {
    const before = (rows.get(row) || []).filter(record => record.startMs < Date.parse(fix.landedAt) && record.outcome).at(-1);
    if (!before) { verdicts.push({kind: 'fixed', row, commit: fix.commit, verdict: 'live', why: (rows.get(row) || []).length ? 'no recording from before the fix' : 'no recording of this row'}); continue; }
    jobs.push({kind: 'fixed', row, commit: fix.commit, landedAt: fix.landedAt, record: strip(before, history)});
  }
  for (const [row, list] of rows) {
    const newest = list.at(-1), older = list.slice(0, -1).filter(record => record.outcome && compare(record.outcome, newest.outcome) > 0).at(-1);
    if (!newest.outcome || !older) continue;
    jobs.push({kind: 'regression', row, record: strip(newest, history), older: strip(older, history)});
  }
  if (jobs.length > MAX_JOBS) for (const job of jobs.splice(MAX_JOBS)) verdicts.push({kind: job.kind, row: job.row, commit: job.commit, verdict: 'live', why: 'not replayed this time (too many rows at once)'});
  return {jobs, verdicts};
}

if (process.argv[1] && process.argv[1].endsWith('verify-plan.mjs')) {
  const [root, out] = process.argv.slice(2);
  if (!root || !out) { console.error('usage: node verify-plan.mjs <records dir> <out file>'); process.exit(2); }
  const result = plan({rows: recordsByRow(root, poolByUrl()), ledger: buildLedger(), history: mainHistory()});
  fs.writeFileSync(out, `${JSON.stringify(result, null, 1)}\n`);
  console.log(`verify-plan: ${result.jobs.length} row(s) to replay, ${result.verdicts.length} answered now`);
  for (const job of result.jobs) console.log(`  ${job.kind}: ${job.row}`);
}
