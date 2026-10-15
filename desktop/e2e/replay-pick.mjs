// The PR replay gate's rows (owner, 14 Oct 2026: "on the PR we can keep only 10, most relevant, or the most quick ... as a quick safety gate. Then the full 50 rows
// will run on a schedule"). From the baseline (the last green scheduled run's results, replay-gate.mjs) only the rows 100% same as live there (only those can be judged
// worse), quickest first, one per posting site before a second from the same site, at most MAX; split into GROUPS runner groups (newline-joined names: JP_REPLAY_ONLY).
// No baseline yet: no rows (the PR gate says so; any green replay on main makes one, e.g. by hand: gh workflow run site-replays.yml --ref main). Guard: e2e/test/replay-pick.test.mjs.
// Since 15 Oct 2026 (the ratchet, lib/replay-ratchet.mjs): with replay-faithful.json pinning rows, a PR replays one pinned row per kind of form (below); the scheduled runs replay every row.
//   node replay-pick.mjs <baseline results.json | -> [--pinned <replay-faithful.json>]   -> {"groups": ["name\nname", ...], "line": "..."}
import fs from 'node:fs';
import path from 'node:path';
import {load, pinned} from './lib/replay-ratchet.mjs';
import {platformOf} from '../../site/src/platform.js';

// Since 15 Oct 2026 (owner: "one row per kind of form. We want diversity", balancing speed, diversity and reliability): a PR replays ONE pinned row per kind of form, the quickest of
// its kind, at most MAX kinds, on at most GROUPS runners (3 rows each). A kind is the pool's platform (site/src/platform.js platformOf of the row's start address); a site on no known
// platform is its own kind. The scheduled runs (site-replays.yml, 4 a day) replay every row, the late-answer pass too.
export const MAX = 12, GROUPS = 4;

// baseline: {rows: {name: {same, seconds, site}}} -> the names, in pick order.
export function pickRows(baseline = {}, {max = MAX} = {}) {
  const rows = baseline?.rows || {};
  const counted = Object.keys(rows).filter(name => rows[name]?.same === true)
    .sort((a, b) => (rows[a].seconds ?? Infinity) - (rows[b].seconds ?? Infinity) || a.localeCompare(b));
  const seen = new Set(), first = [], again = [];
  for (const name of counted) { const site = rows[name].site || name; (seen.has(site) ? again : first).push(name); seen.add(site); }
  return [...first, ...again].slice(0, max);
}

// The pool's rows by name -> their start host (desktop/e2e/smoke-sites.json: the first address of the row's shape).
export function startHosts(file = new URL('./smoke-sites.json', import.meta.url)) {
  let shapes = []; try { shapes = JSON.parse(fs.readFileSync(file, 'utf8')).shapes || []; } catch { /* no pool file */ }
  return new Map(shapes.flatMap(item => { try { return [[item.shape, new URL(item.urls[0]).host]]; } catch { return []; } }));
}

// A row's kind of form: its platform, or the row's own name when its site is on no known platform ("Custom": each such site is its own kind).
export const kindOf = (name, hosts = startHosts()) => { const platform = hosts.has(name) ? platformOf(hosts.get(name)) : 'Custom'; return platform === 'Custom' ? name : platform; };

// The kinds a set of pinned rows has, and how many a PR picks of them: min(MAX, kinds). The workflow's name says "(<k> of <n> pinned rows)" with these.
export const pickedCount = (names, hosts = startHosts(), max = MAX) => Math.min(max, new Set(names.map(name => kindOf(name, hosts))).size);

// pinned names -> one per kind (the quickest by the baseline's seconds, then by name), the quickest kinds first, at most max.
export function pickPinned(names, {seconds = {}, hosts = startHosts(), max = MAX} = {}) {
  const time = name => seconds[name] ?? Infinity, byKind = new Map();
  for (const name of [...names].sort((a, b) => time(a) - time(b) || a.localeCompare(b))) { const kind = kindOf(name, hosts); if (!byKind.has(kind)) byKind.set(kind, name); }
  return [...byKind.entries()].sort(([ka, a], [kb, b]) => time(a) - time(b) || ka.localeCompare(kb)).slice(0, max).map(([, name]) => name);
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
  const seconds = Object.fromEntries(Object.entries(baseline?.rows || {}).map(([name, row]) => [name, row?.seconds]).filter(([, value]) => value != null));
  const names = pins.length ? pickPinned(pins, {seconds}) : pickRows(baseline), groups = split(names);
  const line = pins.length ? `## Replay gate (PR): ${names.length} of ${pins.length} pinned rows, one per kind of form, on ${groups.length} runners: ${names.join(', ')}` : names.length ? `## Replay gate (PR): ${names.length} rows on ${groups.length} runners: ${names.join(', ')}`
    : '## Replay gate (PR): no baseline with rows 100% same as live yet: nothing to replay (start one on main by hand: gh workflow run site-replays.yml --ref main)';
  process.stdout.write(`${JSON.stringify({groups: groups.map(group => group.join('\n')), line})}\n`);
}
