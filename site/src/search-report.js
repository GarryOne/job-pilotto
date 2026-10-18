// Real installs' searches (owner, 18 Oct 2026): the app sends one "search" report per finished Find jobs run (desktop/lib/search-report.js: counts and
// seconds, a role family from a fixed list, a country, a city candidate). This is the second check on the server: only the listed fields survive, each
// with the shape it must have. Stored in the telemetry table (90 days, like every technical report); the Lab page's "Real installs" tab reads them.
// A city is shown only when 3+ installs share it (k >= 3 at read time). Tests: test/telemetry.test.js.
const count = v => Number.isInteger(v) && v >= 0 && v < 1e6;
export const FAMILIES = ['software', 'sales_b2b', 'sales_retail', 'logistics', 'hospitality', 'healthcare', 'creative_media', 'finance_admin', 'education', 'trades', 'other'];
export const FIELDS = {
  family: v => FAMILIES.includes(v),
  country: v => /^[A-Z]{2}$/.test(v),
  city: v => typeof v === 'string' && v.length <= 40 && /^[\p{L} .'-]+$/u.test(v),
  in_places: count, scored: count, fit70: count, first_s: count, tenth_s: count, first_fit70_s: count, nth: count, runs_to_fit70: count,
  engine: v => ['api', 'cli', 'openai', 'codex'].includes(v),
  trigger: v => ['first', 'you', 'schedule', 'telegram', 'other'].includes(v),
};
const ENVELOPE = ['kind', 'at', 'install', 'version', 'platform', 'os', 'source'];

// The report as it may be stored: its envelope and the listed fields; the rest is dropped.
export function clean(item) {
  const out = Object.fromEntries(ENVELOPE.filter(key => item[key] != null).map(key => [key, item[key]]));
  for (const [key, ok] of Object.entries(FIELDS)) if (ok(item[key])) out[key] = item[key];
  return out;
}
