// The PR replay gate's rows (owner, 14 Oct 2026: "on the PR we can keep only 10, most relevant, or the most quick ... as a quick safety gate. Then the full 50 rows
// will run on a schedule"). From the baseline (the last green scheduled run's results, replay-gate.mjs) only the rows 100% same as live there (only those can be judged
// worse), quickest first, one per posting site before a second from the same site, at most MAX; split into GROUPS runner groups (newline-joined names: JP_REPLAY_ONLY).
// No baseline yet: no rows (the PR gate says so; any green replay on main makes one, e.g. by hand: gh workflow run site-replays.yml --ref main). Guard: e2e/test/replay-pick.test.mjs.
// Since 15 Oct 2026 (the ratchet, lib/replay-ratchet.mjs): with replay-faithful.json pinning rows, EVERY pinned row is replayed (no cap of 10): a replay-machinery or apply-flow PR can lose none.
//   node replay-pick.mjs <baseline results.json | -> [--pinned <replay-faithful.json>]   -> {"groups": ["name\nname", ...], "line": "..."}
import fs from 'node:fs';
import path from 'node:path';
import {load, pinned} from './lib/replay-ratchet.mjs';

export const MAX = 10, GROUPS = 5;

// baseline: {rows: {name: {same, seconds, site}}} -> the names, in pick order.
export function pickRows(baseline = {}, {max = MAX} = {}) {
  const rows = baseline?.rows || {};
  const counted = Object.keys(rows).filter(name => rows[name]?.same === true)
    .sort((a, b) => (rows[a].seconds ?? Infinity) - (rows[b].seconds ?? Infinity) || a.localeCompare(b));
  const seen = new Set(), first = [], again = [];
  for (const name of counted) { const site = rows[name].site || name; (seen.has(site) ? again : first).push(name); seen.add(site); }
  return [...first, ...again].slice(0, max);
}

// names -> at most `groups` groups, round robin (the quickest rows spread over the runners).
export function split(names, groups = GROUPS) {
  const out = Array.from({length: Math.min(groups, names.length)}, () => []);
  names.forEach((name, index) => out[index % out.length].push(name));
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node replay-pick.mjs <baseline results.json | ->'); process.exit(2); }
  let baseline = {};
  try { baseline = file === '-' ? {} : JSON.parse(fs.readFileSync(file, 'utf8')); } catch { baseline = {}; }
  const at = process.argv.indexOf('--pinned'), pins = at > 0 ? pinned(load(process.argv[at + 1])) : [];
  const names = pins.length ? pins : pickRows(baseline), groups = split(names);
  const line = pins.length ? `## Replay gate (PR): every pinned row (${names.length}) on ${groups.length} runners: ${names.join(', ')}` : names.length ? `## Replay gate (PR): ${names.length} rows on ${groups.length} runners: ${names.join(', ')}`
    : '## Replay gate (PR): no baseline with rows 100% same as live yet: nothing to replay (start one on main by hand: gh workflow run site-replays.yml --ref main)';
  process.stdout.write(`${JSON.stringify({groups: groups.map(group => group.join('\n')), line})}\n`);
}
