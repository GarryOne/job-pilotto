// The "Needs a fix" order of /admin/applying, in ONE place: the page embeds ORDER_SOURCE (the function's own source) into its script, and tools/needs-fix-order.mjs imports the
// function, so the page and the command can never disagree. Self-contained on purpose (no outer names, no backticks, no template or backslash characters): it is pasted into the page.
// Guard: test/needs-fix-order.test.js (same seeded data through the page and the command).

// pool: the page's pool rows (name, platform, reached, regression, short, note); scorecard: [{platform, matchShare}]; steps: the page's step names, earliest first.
// -> {rows: the sites that need a fix, worst first; rank: Map(shape -> place; the shape is unique, two sites can share a display name); needs(site); useOf(site)}.
// Needs a fix = not a posting that is gone, and a regression, a shortfall, or a stop before the form (a code or bot check is a documented hold, not a fix).
// Worst first (owner, 10 Oct 2026): a regression, then the platform real people use most (its share of the matched jobs), then the earliest stop (a form last),
// then the most unexplained fields, then the name.
export function needsFixOrder(pool, scorecard, steps) {
  const needs = s => !s.note && !!s.reached && (s.regression || !!s.short || ['none', 'posting', 'account'].includes(s.reached));
  const useOf = s => (scorecard || []).find(item => item.platform === s.platform)?.matchShare ?? 0;
  const stageOf = s => (s.short ? 100 : steps.indexOf(s.reached));
  const byWorst = (a, b) => (Number(!!b.regression) - Number(!!a.regression)) || (useOf(b) - useOf(a)) || (stageOf(a) - stageOf(b)) || ((b.short?.unexplained || 0) - (a.short?.unexplained || 0)) || a.name.localeCompare(b.name);
  const rows = pool.filter(needs).sort(byWorst);
  return {rows, rank: new Map(rows.map((s, i) => [s.shape ?? s.name, i])), needs, useOf};
}
export const ORDER_SOURCE = needsFixOrder.toString();
