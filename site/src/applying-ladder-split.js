// How each rung's sites ended on the lab page's ladder chart: fine, a documented hold, or failed (owner, 15 Oct 2026: "72% stopped here" read as a problem when most were fine).
// ladderSplit(pool) and SPLIT_KINDS are also sent to the page as source. Guard: test/applying-ladder-split.test.js.
export const SPLIT_KINDS = [{key: 'fine', word: 'fine'}, {key: 'held', word: 'held'}, {key: 'failed', word: 'failed'}];

// pool: the page's rows ({rung, status: {state}}), state from src/applying-status.js rowStatus. works = fine, held = a documented hold,
// anything else (fix, posting gone or site refused, not run) = failed: it stopped and no hold explains it.
export function ladderSplit(pool) {
  const byRung = {};
  let total = 0;
  for (const site of pool || []) {
    if (site.rung == null) continue;
    const state = site.status?.state, kind = state === 'works' ? 'fine' : state === 'held' ? 'held' : 'failed';
    const part = (byRung[site.rung] ||= {fine: 0, held: 0, failed: 0, count: 0});
    part[kind] += 1; part.count += 1; total += 1;
  }
  return {total, byRung};
}
export const SPLIT_SOURCE = ladderSplit.toString();
