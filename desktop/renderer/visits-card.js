// The result of "Read sites only you can open" (Actions; lib/visits.js resultMessage writes it): parsed for its card. Pure.
// 🌐 Sites read / Read 4 of 5 sites · 186 jobs (61 new) / ✓ LinkedIn · 64 jobs (20 new) · <url> / ✗ Rolex · <why> · <url>
export function parseVisits(text) {
  const lines = String(text || '').split('\n').map(line => line.trim()).filter(Boolean);
  if (lines[0] !== '🌐 Sites read') return null;
  const head = /^Read (\d+) of (\d+) sites? · (\d+) jobs? \((\d+) new\)/.exec(lines[1] || '');
  if (!head) return null;
  const sites = [];
  for (const line of lines.slice(2)) {
    const row = /^([✓✗]) (.+?) · (.+) · (https?:\/\/\S+)$/.exec(line);
    if (row) sites.push({ok: row[1] === '✓', name: row[2], detail: row[3], url: row[4]});
  }
  return {kind: 'visits', read: Number(head[1]), total: Number(head[2]), jobs: Number(head[3]), fresh: Number(head[4]), sites};
}
// A Read sites run's tabs, from its log (lib/visits.js siteLine: `  ▸ <state> · <site> · <words>`): one row per site in the order they were
// listed, each at its latest state, and how far the run is (sites finished of all, as a percent). Pure; null when the log has none.
const FINISHED = new Set(['done', 'stopped']);
export function parseSiteRows(lines) {
  const rows = new Map();
  for (const line of lines || []) {
    const found = /^\s+▸ (next|opening|waiting|reading|done|stopped) · (.+?) · (.*)$/.exec(String(line));
    if (!found) continue;
    const [, state, name, words] = found;
    const row = rows.get(name) || {name, url: ''};
    if (state === 'next' && /^https?:\/\//.test(words)) row.url = words;
    rows.set(name, {...row, state, words: state === 'next' ? 'Next' : words});
  }
  if (!rows.size) return null;
  const sites = [...rows.values()], done = sites.filter(site => FINISHED.has(site.state)).length;
  return {sites, done, total: sites.length, percent: Math.round(done / sites.length * 100)};
}
