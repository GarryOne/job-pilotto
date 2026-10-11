// "Needs a fix" by cause, in ONE place: the page embeds GROUPS_SOURCE (the function's own source) as its "By cause" tab and tools/needs-fix-causes.mjs imports the function, so the page
// and the command cannot disagree. needsFixGroups leans on needsFixOrder (src/applying-order.js): the page defines that name before this source, the module imports it.
// No backticks, template or backslash characters: the source is pasted into the page. Guard: test/needs-fix-causes.test.js.
import {needsFixOrder} from './applying-order.js';

// The newest of some dotted versions ("0.9.188"), numeric not alphabetical; null when there is none. Used by the server to find the latest landed build (the uploaded runs and the fix ledger).
export const newestVersion = versions => (versions || []).filter(v => /^\d+(\.\d+)*$/.test(String(v || ''))).reduce((best, v) => {
  const a = String(v).split('.').map(Number), b = String(best || '').split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0) ? v : best; }
  return best;
}, null);

// pool: the page's pool rows (name, shape, platform, at, version, claimed, cause: {cause} | null ...); latestBuild: the newest landed build, or null.
// -> groups, in this order: "Run first" (rows whose last run is older than latestBuild, or that never ran: they need a pool run, not a fix), then one group per top cause, the biggest first,
//    then "No cause recorded". Each: {key, label, hint, count, rows (worst first; Run first: never run, then the oldest), claimed (rows a session holds), neverRun, oldest (the oldest run time, or null)}.
// A row is listed when it needs a fix (needsFixOrder) or has never run; a stale row with nothing to fix is not listed. The session that holds a claim is never on the site.
export function needsFixGroups(pool, scorecard, steps, latestBuild) {
  const older = (a, b) => {
    const x = String(a || '').split('.').map(Number), y = String(b || '').split('.').map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); }
    return false;
  };
  const needing = needsFixOrder(pool, scorecard, steps).rows, listed = new Set(needing);
  const never = pool.filter(s => !s.at && !listed.has(s));
  const staleRun = s => !!s.at && !!latestBuild && (!s.version || older(s.version, latestBuild));
  const first = [...never, ...needing.filter(s => staleRun(s))];
  const firstSet = new Set(first);
  first.sort((a, b) => (!b.at - !a.at) || String(a.at || '').localeCompare(String(b.at || '')));
  const byCause = {};
  for (const s of needing) if (!firstSet.has(s)) (byCause[s.cause && s.cause.cause ? s.cause.cause : ''] ||= []).push(s);
  const make = (key, label, hint, rows) => ({key, label, hint, count: rows.length, rows,
    claimed: rows.filter(s => s.claimed).length, neverRun: rows.filter(s => !s.at).length, oldest: rows.map(s => s.at).filter(Boolean).sort()[0] || null});
  const groups = [make('run-first', 'Run first', 'Last run older than the latest build, or never run: a pool run, not a fix', first)];
  Object.keys(byCause).filter(cause => cause).sort((a, b) => byCause[b].length - byCause[a].length || a.localeCompare(b)).forEach(cause => groups.push(make('cause:' + cause, cause, '', byCause[cause])));
  groups.push(make('no-cause', 'No cause recorded', 'No fill card names a cause for these rows', byCause[''] || []));
  return groups.filter(group => group.rows.length);
}
export const GROUPS_SOURCE = needsFixGroups.toString();
