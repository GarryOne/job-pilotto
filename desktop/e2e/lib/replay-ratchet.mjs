// The replay ratchet (owner, 15 Oct 2026: "~40 fixes and still some old replays don't work anymore"): replay-faithful.json pins every row that was proven same as live, per
// place (mac, runner) with the commit it was proven on. The gate's baseline is that file, not the last green run, so a lost row can never leave the counted set on its own.
// The tool only RAISES the file (pin); a row leaves it only in a PR that names it in a Replay-accept line. Pure parts here; guard: e2e/test/replay-ratchet.test.mjs.
import fs from 'node:fs';
import path from 'node:path';

export const FILE = new URL('../replay-faithful.json', import.meta.url);
export const PLACES = ['mac', 'runner'];

export const load = (file = FILE) => { try { const data = JSON.parse(fs.readFileSync(file, 'utf8')); return data && typeof data.rows === 'object' ? data : {rows: {}}; } catch { return {rows: {}}; } };

// The rows the gate holds to "same as live": those pinned on the runner (the place the PR gate and the scheduled run replay on).
export const pinned = (data = load()) => Object.keys(data.rows || {}).filter(name => data.rows[name]?.runner === true).sort();

// (a results.json of a run: {rows: {name: {same, deferred}}}, the file, {place, commit, at}) -> a new file with every row that was same as live in the run set true for that place.
// Never lowers (a row not same stays as it was), never pins a deferred row.
export function pin(results, data = {rows: {}}, {place = 'runner', commit = '', at = new Date().toISOString()} = {}) {
  if (!PLACES.includes(place)) throw new Error(`place must be one of ${PLACES.join(', ')}`);
  const rows = {...(data.rows || {})};
  for (const [name, row] of Object.entries(results?.rows || {})) {
    if (row?.same !== true || row.deferred) continue;
    const old = rows[name] || {mac: null, runner: null};
    rows[name] = {...old, [place]: true, [`${place}Commit`]: old[place] === true ? old[`${place}Commit`] || commit : commit, [`${place}At`]: old[place] === true ? old[`${place}At`] || at : at};
  }
  return {rows: Object.fromEntries(Object.entries(rows).sort(([a], [b]) => a.localeCompare(b)))};
}

// Rows pinned in the base's file and missing (or not true on the runner) in this PR's file: a pin lowered. Each needs a Replay-accept line naming it.
export const lowered = (base, now) => pinned(base).filter(name => now?.rows?.[name]?.runner !== true);

// Rows same as live in this run and not pinned yet: the gate says "ratchet up".
export const newlyFaithful = (results, data) => Object.entries(results?.rows || {}).filter(([name, row]) => row?.same === true && !row.deferred && data?.rows?.[name]?.runner !== true).map(([name]) => name).sort();

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [command, resultsFile, ...rest] = process.argv.slice(2), arg = flag => { const at = rest.indexOf(flag); return at >= 0 ? rest[at + 1] : ''; };
  if (command !== 'pin' || !resultsFile) { console.error('usage: node lib/replay-ratchet.mjs pin <results.json> --commit <sha> [--place runner|mac] [--file <replay-faithful.json>]'); process.exit(2); }
  const file = arg('--file') || FILE, before = load(file), results = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
  const after = pin(results, before, {place: arg('--place') || 'runner', commit: arg('--commit') || results.sha?.slice(0, 7) || ''});
  fs.writeFileSync(file, `${JSON.stringify(after, null, 1)}\n`);
  const added = Object.keys(after.rows).filter(name => !before.rows[name] || PLACES.some(place => before.rows[name][place] !== after.rows[name][place]));
  console.log(`replay-ratchet: ${pinned(after).length} rows pinned on the runner (${added.length} new this time${added.length ? `: ${added.join(', ')}` : ''})`);
}
