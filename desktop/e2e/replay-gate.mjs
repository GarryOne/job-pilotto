// The offline replay's gate (spec docs/superpowers/specs/2026-10-13-replay-by-network.md "Schedule, gate and alerts"; owner, 14 Oct 2026): each row's replay on main
// against the baseline (the last green run: same recordings, same runner), never against live. A row COUNTS only when it was 100% the same as live in the baseline
// ("only count the 100% same as live"); a counted row whose OUTCOME (step reached, boxes filled, boxes left) fell is worse; one whose outcome rose or only its
// asks changed is "different": it passes and says "re-record to confirm". A worse row replayed again (--retry) that matches the baseline is noise.
// Guard: e2e/test/replay-gate.test.mjs. Run: node replay-gate.mjs <step-4 dir> <baseline results.json | -> <out results.json> [--retry <step-4 dir>]
import fs from 'node:fs';
import path from 'node:path';
import {rank} from './lib/smoke.mjs';
import {isSame} from './replay-records.mjs';

const json = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };

// Why a row's outcome fell from the baseline's, or '' (a missing number on either side never counts as a fall).
export function fell(before, now) {
  if (!before || !now) return '';
  if (rank(now.reached) < rank(before.reached)) return `reached ${now.reached}, baseline ${before.reached}`;
  if (before.filled != null && now.filled != null && now.filled < before.filled) return `filled ${now.filled}, baseline ${before.filled}`;
  if (before.left != null && now.left != null && now.left > before.left) return `left ${now.left}, baseline ${before.left}`;
  return '';
}
const rose = (before, now) => !!(before && now && (rank(now.reached) > rank(before.reached) || (now.filled ?? 0) > (before.filled ?? 0)));

// (this run's records, the baseline's results, a retry's records) -> {rows: {name: {same, outcome, counted, verdict, why}}, counted, worse, red}
export function judge(records, baseline = {}, retry = []) {
  const again = new Map(retry.map(record => [record.name, record])), rows = {};
  for (const record of records) {
    const before = baseline.rows?.[record.name], counted = before?.same === true, same = isSame(record), outcome = record.outcome || null;
    let verdict = counted ? 'same' : 'not counted', why = counted ? '' : before ? 'replay not faithful in the baseline' : 'no baseline yet';
    if (counted && !record.network) { verdict = 'worse'; why = 'no replay result'; }
    else if (counted) {
      const down = fell(before.outcome, outcome);
      if (down) {
        const second = again.get(record.name), retried = second && fell(before.outcome, second.outcome);
        if (second && !retried) { verdict = 'noise'; why = `${down}; the retry matched the baseline`; } else { verdict = 'worse'; why = down; }
      } else if (!same) { verdict = 'different'; why = `${rose(before.outcome, outcome) ? 'further than the baseline' : 'other asks, same outcome'}: re-record to confirm`; }
    }
    rows[record.name] = {same, outcome, counted, verdict, why, seconds: record.seconds ?? null, site: record.site || ''};   // seconds, site: the PR gate's pick (replay-pick.mjs)
  }
  const list = Object.values(rows), worse = list.filter(row => row.verdict === 'worse').length;
  return {rows, counted: list.filter(row => row.counted).length, total: list.length, worse, red: worse > 0};
}

// The run's Markdown: one line "N of M rows counted · K worse", then the rows that matter.
export function summary(result) {
  const lines = [`## Replay gate: ${result.counted} of ${result.total} rows counted · ${result.worse} worse`, ''];
  const shown = Object.entries(result.rows).filter(([, row]) => row.verdict !== 'same').sort(([a], [b]) => a.localeCompare(b));
  if (shown.length) lines.push('| Row | Verdict | Why |', '|---|---|---|', ...shown.map(([name, row]) => `| ${name} | ${row.verdict} | ${row.why || '–'} |`));
  return `${lines.join('\n')}\n`;
}

const recordsIn = dir => (dir && fs.existsSync(dir) ? fs.readdirSync(dir).filter(file => file.endsWith('.json')).map(file => json(path.join(dir, file), null)).filter(Boolean) : []);

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [dir, base, out] = process.argv.slice(2), at = process.argv.indexOf('--retry'), retryDir = at > 0 ? process.argv[at + 1] : '';
  if (!dir || !base || !out) { console.error('usage: node replay-gate.mjs <step-4 dir> <baseline results.json | -> <out results.json> [--retry <step-4 dir>]'); process.exit(2); }
  const result = judge(recordsIn(dir), base === '-' ? {} : json(base, {}), recordsIn(retryDir));
  fs.writeFileSync(out, `${JSON.stringify({at: new Date().toISOString(), sha: process.env.GITHUB_SHA || '', ...result}, null, 1)}\n`);
  if (!retryDir) fs.writeFileSync(`${out}.worse`, Object.entries(result.rows).filter(([, row]) => row.verdict === 'worse').map(([name]) => name).join('\n'));
  process.stdout.write(summary(result));
  process.exit(result.red ? 1 : 0);
}
