// Lab Form Filling: one judgment per pool row, so Needs a fix and the Resolution tab never disagree. Pure; guard: test/applying-judgment.test.js.
// One judgment per pool row (owner, 15 Oct 2026: Resolution said "unresolved 9", Needs a fix listed 6, only 2 in common). The row's status comes from its smoke run;
// its ending (Resolution) is the extension's own judgment of a run. When the ending is at least as new as the smoke run, it decides the status, so Needs a fix
// (what fix-recorded-sites works from) holds every unresolved row and none the ending calls resolved. A named test hold (account-first, login wall) stays a hold.
export const ENDING_STATE = {unresolved: 'fix', blind: 'fix', ready: 'works', data_missing: 'works', held: 'held', told: 'held', handed: 'held', site_broken: 'site'};
export function oneJudgment(pool, resolution) {
  const endings = new Map((resolution?.rows || []).map(row => [row.row, row]));
  for (const item of pool) {
    const ending = endings.get(item.shape) || endings.get(item.name), want = ending && ENDING_STATE[ending.ending];
    if (!want || !item.status || item.status.state === 'held' || item.status.state === want) continue;
    if (item.day && ending.day && ending.day < item.day) continue;   // an older ending never overrides a newer run
    item.status = {...item.status, state: want, rule: 'ending: ' + ending.ending.replace('_', ' '), step: ending.step || item.status.step, from: 'ending'};
  }
  return pool;
}
