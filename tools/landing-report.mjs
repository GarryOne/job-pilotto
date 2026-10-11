// Prints, per landing, where the time went: edit, lock waits, proof runs, queue, rebase, gate, push (from ship-timeline.log and the heavy-lock lines of gate-timing.log). Guarded by tests/test_ship_timeline.py.
//   node tools/landing-report.mjs <branch>          every landing attempt of that branch
//   node tools/landing-report.mjs --last <n>        the last n attempts of any branch
//   --dir <git common dir>                          where the two logs are (default: this repo's)
// "not measured" is printed where the logs do not say (a heavy-lock line from before the branch/session fields, no first commit time).
import {readFileSync, existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const dir = flag('--dir') ?? execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {encoding: 'utf8'}).trim();
const last = flag('--last');
const branch = args[0];
if (!branch && !last) { console.error('usage: node tools/landing-report.mjs <branch> | --last <n> [--dir <git common dir>]'); process.exit(2); }

const read = (name) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8').split(/\r?\n/).filter(Boolean) : []);
const fields = (line) => Object.fromEntries([...line.matchAll(/(\w+)=(\S*)/g)].map((m) => [m[1], m[2]]));
const secs = (v) => (v === undefined || v === '' || v === '?' ? null : parseInt(String(v).replace(/s$/, ''), 10));
const time = (v) => { const t = Date.parse(v); return Number.isNaN(t) ? null : t; };

export function parseTimeline(lines) { return lines.filter((l) => l.startsWith('ts_start=')).map(fields); }
export function parseHeavy(lines) {   // the "run=" lines carry wait and run; the old "wait=" lines (no run) are only counted when no run line exists for them
  return lines.filter((l) => /^# \S+ heavy lock run=/.test(l)).map((l) => ({at: time(l.split(' ')[1]), ...fields(l)}));
}
export function report(landings, heavy) {
  return landings.map((l) => {
    const end = time(l.ts_end), start = time(l.ts_start), first = time(l.first_commit);
    const mine = heavy.filter((h) => h.branch === l.branch && h.at !== null && end !== null && h.at <= end && (first === null || h.at >= first - 1000));
    const known = mine.length > 0 && mine.every((h) => h.run !== undefined);
    const lockWait = known ? mine.reduce((a, h) => a + (secs(h.wait) ?? 0), 0) : null;
    const proofRun = known ? mine.reduce((a, h) => a + (secs(h.run) ?? 0), 0) : null;
    const editSecs = first !== null && start !== null ? Math.max(0, Math.round((start - first) / 1000) - (lockWait ?? 0) - (proofRun ?? 0)) : null;
    return {branch: l.branch, session: l.session, result: l.result, end: l.ts_end, edit: editSecs, lockWait, proofRun, queue: secs(l.queue), rebase: secs(l.rebase), gate: secs(l.checks),
      wfWait: secs(l.wf_wait), push: secs(l.push), ship: secs(l.total), refused: l.refused, skipped: l.skipped, gateSteps: l.gate_steps, proofRuns: mine.map((h) => `${h.what} wait ${h.wait} run ${h.run} load ${h.load_q}->${h.load_start}`)};
  });
}
const cell = (v) => (v === null || v === undefined ? 'not measured' : `${v}s`);
export function render(rows) {
  return rows.map((r) => [
    `${r.branch} (${r.session}) ${r.result} at ${r.end}; ship ${cell(r.ship)}, refused ${r.refused ?? '?'} (re-checks skipped ${r.skipped ?? '?'})`,
    `  edit/think  ${cell(r.edit)}`, `  lock wait   ${cell(r.lockWait)}`, `  proof runs  ${cell(r.proofRun)}${r.proofRuns.length ? '  [' + r.proofRuns.join('; ') + ']' : ''}`,
    `  queue       ${cell(r.queue)}`, `  rebase+ver  ${cell(r.rebase)}`, `  gate        ${cell(r.gate)}  (${r.gateSteps ?? 'not measured'})`, `  workflow wait ${cell(r.wfWait)}`, `  push        ${cell(r.push)}`,
  ].join('\n')).join('\n\n');
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('landing-report.mjs')) {
  let landings = parseTimeline(read('ship-timeline.log'));
  landings = branch ? landings.filter((l) => l.branch === branch) : landings.slice(-Number(last));
  if (!landings.length) { console.log(`no landing attempts found${branch ? ` for ${branch}` : ''} in ${join(dir, 'ship-timeline.log')}`); process.exit(0); }
  console.log(render(report(landings, parseHeavy(read('gate-timing.log')))));
}
