// One run of the producer as numbers (5 Oct 2026): what it filed, saw again, closed, dropped (by reason) and called stale, the build's distance from main and the suites that did not finish.
// The reasons findings were dropped were only text in the step summary, so "how much noise does the Finder filter out, and why" had no data. Pure.
export function dropReason(why = '') {
  const text = String(why);
  if (/^stale sighting/i.test(text)) return 'stale-sighting';
  if (/cap\b/i.test(text)) return 'over-the-cap';
  if (/closed as a false positive|judged noise|false.positive/i.test(text)) return 'known-false-positive';
  if (/judged (?:false-positive|harness)/i.test(text)) return 'judged-before-filing';
  if (/low|no impact/i.test(text)) return 'low-or-no-impact';
  return 'other';
}

export function runSummary(result, {runUrl = '', build = '', incomplete = [], at = new Date().toISOString()} = {}) {
  const dropped = {};
  for (const item of result.dropped || []) { const key = dropReason(item.why); dropped[key] = (dropped[key] || 0) + 1; }
  return {v: 1, at, run: runUrl, build, behind: Number.isFinite(result.behind) ? result.behind : null, incomplete,
    findings: (result.findings || []).length, filed: (result.filed || []).length, again: (result.again || []).length, gone: (result.gone || []).length,
    closed: (result.closed || []).length, stale: (result.stale || []).length, sameCause: (result.sameCause || []).length, dropped};
}

// Many summaries -> totals for the page: {runs, filed, stale, dropped: {reason: n}, incompleteRuns, behindMax}.
export function totalRuns(list) {
  const out = {runs: 0, filed: 0, stale: 0, incompleteRuns: 0, behindMax: 0, dropped: {}};
  for (const item of list) {
    if (!item || item.v !== 1) continue;
    out.runs++; out.filed += item.filed || 0; out.stale += item.stale || 0;
    if ((item.incomplete || []).length) out.incompleteRuns++;
    out.behindMax = Math.max(out.behindMax, item.behind || 0);
    for (const [key, count] of Object.entries(item.dropped || {})) out.dropped[key] = (out.dropped[key] || 0) + count;
  }
  return out;
}
