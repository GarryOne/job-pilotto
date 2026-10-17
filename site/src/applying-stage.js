// The pool's life cycle (owner, 17 Oct 2026: "new -> needs a fix -> fixed -> archived; only the failing sites and ~7 daily rows run"). A pool row is in exactly one stage; nothing is deleted:
//   new       recorded once or not yet run
//   fix       its newest run is short (the Needs a fix list; src/applying-status.js)
//   fixed     a fix landed, 2 clean runs followed it (src/applying-fixed.js "Confirmed") and a recorded page case guards it
//   watch     on the daily watch list (the row's data: stage "watch" in smoke-sites.json)
//   working   works, is not new and is not on the daily list: waits to be archived
//   archived  fixed or working and not daily, or its posting is gone: the recorder never re-runs it; kept for history and offline debugging (the row's data: stage "archived" + why)
// Stages are DATA on the row (`stageData`) only for "watch" and "archived" (desktop/e2e/smoke-sites.json, uploaded with the pool); every other stage is derived here from what the page already computes.
// `archivable` says why a row may be archived, or null: tools/archive-pool-rows.mjs writes it into the pool list. Guard: test/applying-stage.test.js.
export const STAGES = ['fix', 'new', 'working', 'fixed', 'watch', 'archived'];   // the order the Stage filter shows
export const STAGE_WORD = {new: 'New', fix: 'Needs a fix', fixed: 'Fixed', watch: 'Daily watch', working: 'Working', archived: 'Archived'};
export const STAGE_DATA = ['watch', 'archived'];   // the two stages a row's data sets
export const ARCHIVE_WHY = ['fixed', 'working', 'posting-gone'];
const CLEAN_RUNS = 3;   // a working row is archivable after this many runs, the newest all good

// item: a pool row as the page builds it ({stage, status, runs, ...}); fixedRow: its Fixed tab row ({status, cases}) or undefined.
export function stageOf(item, fixedRow) {
  if (item.stageData === 'archived') return 'archived';
  if (item.stageData === 'watch') return 'watch';
  if (item.status?.state === 'fix') return 'fix';
  if (fixedRow?.status === 'confirmed' && (fixedRow.cases || []).length) return 'fixed';
  if ((item.runs || []).length <= 1) return 'new';
  return 'working';
}

// -> 'fixed' | 'posting-gone' | 'working' | null. A row on the watch list, a failing row, a new row and an archived row are never archivable.
export function archivable(item, fixedRow) {
  const stage = stageOf(item, fixedRow);
  if (stage === 'fixed') return 'fixed';
  const runs = item.runs || [];
  if (!['archived', 'watch', 'fix'].includes(stage) && item.status?.state === 'site' && item.status.rule === 'posting gone' && runs.length >= 2
    && runs.slice(-2).every(run => run.needsFix == null && !run.hold)) return 'posting-gone';   // twice in a row: a posting that is gone, not a bad moment
  if (stage === 'working' && runs.length >= CLEAN_RUNS && runs.slice(-CLEAN_RUNS).every(run => run.needsFix === false)) return 'working';
  return null;
}

// -> [{name, label, sites}] for the Stage filter, only stages that hold a row.
export const stageCounts = pool => STAGES.map(name => ({name, label: STAGE_WORD[name], sites: pool.filter(item => item.stage === name).length})).filter(item => item.sites > 0);

// Marks every pool row with its stage and why it may be archived. fixed: the Fixed tab's rows ({site, status, cases}).
export function markStages(pool, fixedRows = []) {
  const byName = new Map(fixedRows.map(row => [row.site, row]));
  for (const item of pool) {
    const fixedRow = byName.get(item.shape) || byName.get(item.name);
    item.archivable = archivable(item, fixedRow);
    item.stage = stageOf(item, fixedRow);
  }
  return pool;
}
