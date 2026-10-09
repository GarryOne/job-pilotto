// Employers & Sources, without a window (pages/employers.js draws it): the filter, a feed status's tone, the stats line, an employer's
// research links and detail lines. Field names: src/stores/base.py EMPLOYER_FIELDS. Guarded by test/employers-view.test.js.

// Feed status (the 🏢 Employers & Sources select) → tone: found good, nothing open info, weak warn, watched by hand bad, no feed neutral.
export const FEED_TONES = {'Feed found': 'good', 'No open jobs': 'info', 'Low relevance': 'warn', 'Manual watch': 'bad', 'No public feed': 'neutral'};
export const feedTone = status => FEED_TONES[status] || 'neutral';

const words = row => [row.name, row.website, row.cities, row.relevant_roles, row.ats, row.slug, row.notes, row.origin, row.kind, row.size]
  .filter(Boolean).join(' ').toLowerCase();

// {text, kind, feed, active: '' | 'on' | 'off'}
export function filterEmployers(rows, {text = '', kind = '', feed = '', active = ''} = {}) {
  const needle = text.trim().toLowerCase();
  return (rows || []).filter(row => (!needle || words(row).includes(needle)) && (!kind || (row.kind || 'Employer') === kind)
    && (!feed || row.feed_status === feed) && (!active || !!row.active === (active === 'on')));
}

// The feed statuses present, in the select's order, then any other value the store holds.
export function feedStatuses(rows) {
  const present = new Set((rows || []).map(row => row.feed_status).filter(Boolean));
  return [...Object.keys(FEED_TONES).filter(status => present.has(status)), ...[...present].filter(status => !(status in FEED_TONES)).sort()];
}

export function statsLine(rows, shown = rows) {
  const all = rows || [], active = all.filter(row => row.active).length, boards = all.filter(row => row.kind === 'Job board').length;
  const feeds = all.filter(row => row.feed_status === 'Feed found').length;
  const head = `${all.length} tracked · ${active} active · ${feeds} with a feed${boards ? ` · ${boards} job board${boards === 1 ? '' : 's'}` : ''}`;
  return shown.length === all.length ? head : `${shown.length} of ${head}`;
}

// The job system and its board name ("greenhouse · acme"), or the feed's host, or ''.
export function feedName(row) {
  if (row.ats) return [row.ats, row.slug].filter(Boolean).join(' · ');
  try { return row.feed ? new URL(row.feed).hostname : ''; } catch { return ''; }
}

// Links to open: [label, url]; only http(s).
export function researchLinks(row) {
  return [['Website', row.website], ['Careers', row.careers_url], ['Feed', row.feed], ['Glassdoor', row.glassdoor], ['levels.fyi', row.levels_fyi]]
    .filter(([, url]) => /^https?:\/\//i.test(String(url || '')));
}

// The muted line under the name: cities, size, relevant roles.
export const metaLine = row => [row.cities, row.size && `${row.size} people`, row.relevant_roles].filter(Boolean).join(' · ');

// The rest of the record, for the row's detail: [label, value] with a value only.
export function detailLines(row) {
  const yes = value => (value === true ? 'yes' : value === false ? 'no' : value);
  return [['Notes', row.notes], ['Integration', row.integration], ['Verification', row.verification],
    ['In your preferred places', yes(row.in_preferred_places)], ['Added', day(row.added || row.created_at)]]
    .filter(([, value]) => value !== undefined && value !== null && value !== '');
}

export function day(iso, now = Date.now()) {
  const at = Date.parse(String(iso || '').length === 10 ? `${iso}T12:00:00` : iso);
  if (!Number.isFinite(at)) return '';
  const thisYear = new Date(at).getFullYear() === new Date(now).getFullYear();   // "8 Oct" this year, "8 Oct 2025" before
  return new Date(at).toLocaleDateString([], {day: 'numeric', month: 'short', ...(thisYear ? {} : {year: 'numeric'})});
}
