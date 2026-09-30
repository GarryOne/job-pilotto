// Recent activity's run list: the runs under "Today" and "Earlier", the time each row shows, and the header's filter.
// Kept free of the window so desktop/test/run-list.test.js can check the day boundary (23:59 vs 00:01), the labels,
// the filter and its counts.
const TIME = {hour: '2-digit', minute: '2-digit', hourCycle: 'h23'};
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
// When a run happened; null while it has no time yet (queued now, or started a moment ago).
const at = run => { const ms = Date.parse(run?.endedAt || run?.startedAt || ''); return Number.isNaN(ms) ? null : new Date(ms); };
// Today: the clock ("18:06"). Before today: its weekday too ("Tue 12:59"), so a bare time is never ambiguous.
export function runTime(run, now = new Date()) {
  const when = at(run);
  if (!when) return '';
  return sameDay(when, now) ? when.toLocaleTimeString([], TIME) : when.toLocaleString([], {...TIME, weekday: 'short'});
}
// [{label, runs}] for the list: Today first, then Earlier; a group with no runs is left out. A row without a time
// (queued, or just started) belongs to Today.
export function groupRuns(runs, now = new Date()) {
  const today = [], earlier = [];
  for (const run of runs) { const when = at(run); (when && !sameDay(when, now) ? earlier : today).push(run); }
  return [['Today', today], ['Earlier', earlier]].filter(([, list]) => list.length).map(([label, list]) => ({label, runs: list}));
}
// The header's filter: the kinds these runs are, with how many, most runs first (the menu it opens).
export function kindCounts(runs, kindOf = run => run?.kind || 'search') {
  const counts = new Map();
  for (const run of runs) counts.set(kindOf(run), (counts.get(kindOf(run)) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).map(([kind, count]) => ({kind, count}));
}
// The runs one filter keeps ('' = every kind).
export function filterRuns(runs, kind, kindOf = run => run?.kind || 'search') {
  return kind ? runs.filter(run => kindOf(run) === kind) : runs;
}
