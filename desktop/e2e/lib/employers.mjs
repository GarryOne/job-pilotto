// Pure checks for the employers suite: what Find new employers must have written into Employers & Sources and the run row, judged from plain values.

// The five outcomes and what each must look like in Notion. `null` = no row at all.
export const EXPECTED = {
  'E2E Nimbus': {status: 'found', feed: 'Feed found', active: true},
  'E2E Orbit': {status: 'found', feed: 'Feed found', active: true},
  'E2E Noise': {status: 'low', feed: 'Low relevance', active: false},
  'E2E Hollow': {status: 'none', feed: 'No public feed', active: false},
  'E2E Ghost': {status: 'none', feed: 'No public feed', active: false},
  'E2E Quiet': {status: 'manual', feed: 'Manual watch', active: false},
  'E2E Acme Labs': {status: 'duplicate', feed: null, active: null},
  'E2E Blocked': {status: 'excluded', feed: null, active: null},
};

const EMPTY = /^(undefined|null|nan|\[object object\])$/i;
export const blank = value => value == null || (typeof value === 'string' && (!value.trim() || EMPTY.test(value.trim()))) || (typeof value === 'number' && Number.isNaN(value));

// -> problems with one employer record (the store's, src/stores/base.py EMPLOYER_FIELDS; on Notion an Employers & Sources row): which fields a row of this kind must carry, and none may be empty or say "undefined".
export function rowProblems(row, kind) {
  const need = {
    found: ['name', 'feed_status', 'ats', 'slug', 'feed', 'quality', 'cities', 'relevant_roles', 'in_preferred_places', 'notes', 'origin', 'tier', 'checked', 'added'],
    low: ['name', 'feed_status', 'ats', 'slug', 'quality', 'notes', 'origin', 'tier', 'checked'],
    none: ['name', 'feed_status', 'origin', 'tier', 'checked'],
    manual: ['name', 'feed_status', 'careers_url', 'origin', 'tier', 'checked'],
  }[kind] || [];
  const out = need.filter(field => blank(row[field])).map(field => `${row.name || '(no name)'}: "${field}" is empty`);
  for (const [field, value] of Object.entries(row)) if (typeof value === 'string' && /\bundefined\b|\bNaN\b|\[object Object\]/.test(value)) out.push(`${row.name}: "${field}" says "${value}"`);
  if (kind === 'found' && !(row.quality >= 1 && row.quality <= 100)) out.push(`${row.name}: quality ${row.quality} is outside 1 to 100`);
  if (kind === 'found' && row.relevant_roles > 0 && !(row.in_preferred_places <= row.relevant_roles)) out.push(`${row.name}: more roles in preferred places (${row.in_preferred_places}) than relevant roles (${row.relevant_roles})`);
  return out;
}

// -> what the scout's run row says ("Source scout · checked 7 · 🆕 2 new sources", or the run's subject) as numbers, or null when it says neither.
export function parseRunLine(text) {
  const checked = /checked\s+(\d+)|(\d+)\s+checked/i.exec(text || ''), fresh = /(\d+)\s+new\s+(?:source|feed)s?/i.exec(text || '');
  return checked || fresh ? {checked: checked ? Number(checked[1] || checked[2]) : null, added: fresh ? Number(fresh[1]) : 0} : null;
}

// -> ordered best first by quality, to compare with what a person would expect.
export const byQuality = rows => [...rows].sort((a, b) => b.quality - a.quality).map(row => row.name);

// -> company names that appear on more than one row (a second run must not write the same employer again).
export function duplicates(rows) {
  const seen = new Map();
  for (const row of rows) { const key = (row.name || '').trim().toLowerCase(); seen.set(key, (seen.get(key) || 0) + 1); }
  return [...seen].filter(([, count]) => count > 1).map(([name]) => name);
}
