// The control repairs' counts since the last successful send to the site (spec docs/superpowers/specs/2026-10-12-fill-ladder.md, PR D2): repair-kept.js counts() are running totals per control
// fingerprint, the baseline of what the site already has is a file beside it (data/repairs-sent.json), so only changes are sent. Fixed values and integers only ({fp, verb, ok, failed}); at most 40
// rows per batch. recipes.js adds the rows to its batch as `repairs` and writes the totals once the site took them. Guard: test/repair-feed.test.js.
import {counts, repairStore} from './repair-kept.js';

export const REPAIRS_SENT = 'data/repairs-sent.json';

// storage: {path(name), readText(name)} as recipes.js has it. -> {rows, totals}
export function repairDelta(storage) {
  if (typeof storage?.path !== 'function') return {rows: [], totals: {}};
  let sentBefore = {}; try { sentBefore = JSON.parse(storage.readText(REPAIRS_SENT) || '{}') || {}; } catch { /* none yet */ }
  const totals = {}, rows = [];
  for (const row of counts(repairStore(storage.path('fill-repairs.json')))) {
    totals[row.fp] = {verb: row.verb, ok: row.ok, failed: row.failed};
    const before = sentBefore[row.fp]?.verb === row.verb ? sentBefore[row.fp] : null;   // a different verb on the fingerprint is a new row
    const ok = row.ok - (before?.ok || 0), failed = row.failed - (before?.failed || 0);
    if (ok > 0 || failed > 0) rows.push({fp: row.fp, verb: row.verb, ok: Math.max(0, ok), failed: Math.max(0, failed)});
  }
  return {rows: rows.slice(0, 40), totals};
}
