// The fill's per-field record, settled at the end: one row per field, its outcome what the page holds once every pass is done.
// Each pass (the kit, the drop-down clicks, Claude on the page) wrote its own row at its own moment; a later pass, or a menu picked meanwhile,
// left rows saying "left" for fields that were filled (8 Oct 2026, the live twin: Coop's "Formule d'appel"). Used by flow.js; guarded by
// worker/test/trace-settle.test.js. finalFields: the form as described at the end ([{label, field, filled}]); missing → the rows decide.
// gaveUp: boxes the page kept emptying after we typed them again, up to the limit ([{field, times}], page/browser-form-fastpath.js): the reason says so.
export function settleTrace(trace = [], finalFields = [], gaveUp = []) {
  const gaveUpTimes = new Map((gaveUp || []).map(item => [item.field, item.times]));
  const fieldOf = new Map((finalFields || []).filter(field => field && field.label).map(field => [field.label, field.field]));
  const filledAtEnd = new Map((finalFields || []).filter(field => field && field.label).map(field => [field.label, !!field.filled]));
  const rows = new Map();
  for (const row of trace || []) {
    if (!row || !row.label) continue;
    const before = rows.get(row.label);
    rows.set(row.label, before && before.outcome === 'filled' && row.outcome !== 'filled' ? {...row, ...before} : {...before, ...row});   // a fill is not undone by a later "left"
  }
  return [...rows.values()].map(row => {
    const end = filledAtEnd.get(row.label);
    if (end === true && row.outcome !== 'filled') return {...row, outcome: 'filled', reason: 'filled by the end of the fill'};
    if (end === false && row.outcome === 'filled' && row.type !== 'file' && row.type !== 'password') return {...row, outcome: 'left', reason: gaveUpTimes.has(fieldOf.get(row.label)) ? `empty again at the end of the fill: the page emptied it after we typed it ${gaveUpTimes.get(fieldOf.get(row.label))} times, so we stopped` : 'empty again at the end of the fill'};
    return row;
  });
}
