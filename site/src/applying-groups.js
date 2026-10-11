// "Needs a fix" by cause, in ONE place: the page embeds GROUPS_SOURCE (the function's own source) as its "By cause" tab and tools/needs-fix-causes.mjs imports the function, so the page
// and the command cannot disagree. needsFixGroups leans on needsFixOrder (src/applying-order.js): the page defines that name before this source, the module imports it.
// No backticks, template or backslash characters: the source is pasted into the page. Guard: test/needs-fix-causes.test.js.
import {needsFixOrder} from './applying-order.js';

// pool: the page's pool rows (name, shape, platform, at, version, claimed, cause: {cause} | null ...); fixedRows: the Fixed tab's rows ({site, fixes: [{extensionVersion, landedAt}]}).
// Groups the rows that NEED A FIX (needsFixOrder), each in exactly one group, so the groups add up to the Needs a fix count. In this order: "Run first" (a row that never ran, or whose last run predates
// a fix landed FOR THAT ROW: it needs a pool run, not a fix), then one group per top cause, the biggest first, then "No cause recorded". A new build alone moves no row: only a fix for the row does.
// -> [{key, label, hint, count, rows (worst first; Run first: never run, then the oldest), reasons (Run first: why each row is there), claimed (rows a session holds), neverRun, oldest (oldest run time or null)}].
// The session that holds a claim is never on the site.
export function needsFixGroups(pool, scorecard, steps, fixedRows) {
  const older = (a, b) => {
    const x = String(a || '').split('.').map(Number), y = String(b || '').split('.').map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); }
    return false;
  };
  const fixOf = {};   // the newest fix landed for each site
  for (const row of fixedRows || []) for (const fix of row.fixes || []) { const have = fixOf[row.site]; if (!have || Date.parse(fix.landedAt) > Date.parse(have.landedAt)) fixOf[row.site] = fix; }
  const reasonOf = s => {
    if (!s.at) return 'never run';
    const fix = fixOf[s.name] || fixOf[s.shape];
    if (!fix) return '';
    const before = s.version && fix.extensionVersion ? older(s.version, fix.extensionVersion) : Date.parse(s.at) < Date.parse(fix.landedAt);
    return before ? 'fix ' + (fix.extensionVersion || 'build') + ' landed since its last run' : '';
  };
  const needing = needsFixOrder(pool, scorecard, steps).rows, first = needing.filter(s => reasonOf(s));
  first.sort((a, b) => (!b.at - !a.at) || String(a.at || '').localeCompare(String(b.at || '')));
  const firstSet = new Set(first), byCause = {};
  for (const s of needing) if (!firstSet.has(s)) (byCause[s.cause && s.cause.cause ? s.cause.cause : ''] ||= []).push(s);
  const make = (key, label, hint, rows, reasons) => ({key, label, hint, count: rows.length, rows, reasons: reasons || [],
    claimed: rows.filter(s => s.claimed).length, neverRun: rows.filter(s => !s.at).length, oldest: rows.map(s => s.at).filter(Boolean).sort()[0] || null});
  const groups = [make('run-first', 'Run first', 'Never run, or run before a fix landed for it: a pool run, not a fix', first, first.map(reasonOf))];
  Object.keys(byCause).filter(cause => cause).sort((a, b) => byCause[b].length - byCause[a].length || a.localeCompare(b)).forEach(cause => groups.push(make('cause:' + cause, cause, '', byCause[cause])));
  groups.push(make('no-cause', 'No cause recorded', 'No fill card names a cause for these rows', byCause[''] || []));
  return groups.filter(group => group.rows.length);
}
export const GROUPS_SOURCE = needsFixGroups.toString();
