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

// -> problems with one Employers & Sources row: which fields a row of this kind must carry, and none may be empty or say "undefined".
export function rowProblems(row, kind) {
  const need = {
    found: ['Company', 'Feed status', 'ATS', 'Slug', 'Feed', 'Quality', 'Cities', 'Relevant roles', 'In preferred places', 'Notes', 'Origin', 'Tier', 'Checked', 'Added'],
    low: ['Company', 'Feed status', 'ATS', 'Slug', 'Quality', 'Notes', 'Origin', 'Tier', 'Checked'],
    none: ['Company', 'Feed status', 'Origin', 'Tier', 'Checked'],
    manual: ['Company', 'Feed status', 'Careers', 'Origin', 'Tier', 'Checked'],
  }[kind] || [];
  const out = need.filter(field => blank(row[field])).map(field => `${row.Company || '(no name)'}: "${field}" is empty`);
  for (const [field, value] of Object.entries(row)) if (typeof value === 'string' && /\bundefined\b|\bNaN\b|\[object Object\]/.test(value)) out.push(`${row.Company}: "${field}" says "${value}"`);
  if (kind === 'found' && !(row.Quality >= 1 && row.Quality <= 100)) out.push(`${row.Company}: quality ${row.Quality} is outside 1 to 100`);
  if (kind === 'found' && row['Relevant roles'] > 0 && !(row['In preferred places'] <= row['Relevant roles'])) out.push(`${row.Company}: more roles in preferred places (${row['In preferred places']}) than relevant roles (${row['Relevant roles']})`);
  return out;
}

// -> what the scout's run row says ("Source scout · checked 7 · 🆕 2 new sources", or the run's subject) as numbers, or null when it says neither.
export function parseRunLine(text) {
  const checked = /checked\s+(\d+)/i.exec(text || ''), fresh = /(\d+)\s+new\s+(?:source|feed)s?/i.exec(text || '');
  return checked || fresh ? {checked: checked ? Number(checked[1]) : null, added: fresh ? Number(fresh[1]) : 0} : null;
}

// -> ordered best first by quality, to compare with what a person would expect.
export const byQuality = rows => [...rows].sort((a, b) => b.Quality - a.Quality).map(row => row.Company);

// -> company names that appear on more than one row (a second run must not write the same employer again).
export function duplicates(rows) {
  const seen = new Map();
  for (const row of rows) { const key = (row.Company || '').trim().toLowerCase(); seen.set(key, (seen.get(key) || 0) + 1); }
  return [...seen].filter(([, count]) => count > 1).map(([name]) => name);
}
