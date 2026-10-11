// The fill's field-by-field log line (background.js "fill: fields: N filled, M left"): one row per field, labels and kinds, never a value.
// It carries `required` (11 Oct 2026, Datadog: it was dropped here, so the smoke report saw "required=?" on every field and counted an optional
// Website left empty as a failure). Read by desktop/e2e/lib/smoke.mjs fieldLines. Guarded by desktop/test/fill-fields.test.js.

// One row per label: a later pass (Claude on the page) wins.
export const loggedFields = trace => [...new Map((trace || []).map(row => [row.label, row])).values()].slice(0, 40).map(row => ({
  label: String(row.label || '').slice(0, 50), type: row.type || '', ...(typeof row.required === 'boolean' ? {required: row.required} : {}),
  outcome: row.outcome, source: row.source || '', reason: row.reason || '', ...(row.alias ? {alias: String(row.alias).slice(0, 30)} : {})}));   // alias: the pack meaning's field key, never a value
