// Usage-weighted pool growth (docs/superpowers/specs/2026-10-10-usage-weighted-pool.md): which sites real users' applications end on, as counts per install and day,
// served only as an aggregate that >= 3 distinct installs used (k >= 3), with the countries of those installs the same way. Never an install, never a path or query.
// Written by the card ingest (src/recipes.js), pruned with the other 90-day tables (src/pool.js), read by /admin/applying "Next sites to add". Guard: test/hostuse.test.js.
export const MIN_INSTALLS = 3;
export const KEEP_DAYS = 90;

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
// A plain host name or null: nothing else is trimmed into shape, so a path, query, port, user, token or address never rides along. The app has the same check
// (desktop/lib/host-clean.js, same cases: test/host-cases.json).
export function cleanHost(value) {
  const raw = String(value ?? '');
  if (!raw || raw.length > 80 || raw !== raw.trim()) return null;
  const host = raw.toLowerCase().replace(/^www\./, '');
  const labels = host.split('.');
  if (labels.length < 2 || labels.length > 6 || !labels.every(label => LABEL.test(label))) return null;
  if (!/^[a-z]{2,24}$/.test(labels[labels.length - 1])) return null;   // no address (a number ends it), no odd ending
  if (labels.some(label => /^[0-9a-f]{20,}$/.test(label) || (label.length >= 28 && /\d/.test(label)))) return null;   // a token-like label
  return host;
}

// One more application ended on `host` (install: the hashed id, as contributions stores it). Returns nothing; a bad host is not stored.
export async function recordUse(db, {install, day, host, ready}) {
  const clean = cleanHost(host);
  if (!clean || !install) return false;
  await db.prepare(`INSERT INTO host_uses (install, day, host, n, ready) VALUES (?, ?, ?, 1, ?)
    ON CONFLICT (install, day, host) DO UPDATE SET n = n + 1, ready = ready + excluded.ready`).bind(install, day, clean, ready ? 1 : 0).run();
  return true;
}

const dayOf = date => date.toISOString().slice(0, 10);

// -> {sites: [{host, installs, uses, ready, countries: [{country, installs}]}], hidden: {hosts}}: hosts used by >= MIN_INSTALLS installs in the window, most installs first.
// The threshold is in the queries, not in the page. A country with fewer than MIN_INSTALLS installs of the host is folded into 'other'.
export async function nextSites(db, {now = new Date(), days = KEEP_DAYS, limit = 50, minInstalls = MIN_INSTALLS} = {}) {
  const since = dayOf(new Date(now.getTime() - days * 86400000));
  const rows = (await db.prepare(`SELECT host, COUNT(DISTINCT install) AS installs, SUM(n) AS uses, SUM(ready) AS ready FROM host_uses WHERE day >= ?
    GROUP BY host HAVING COUNT(DISTINCT install) >= ? ORDER BY installs DESC, uses DESC, host LIMIT ?`).bind(since, minInstalls, Math.max(1, Math.min(200, limit))).all()).results || [];
  const hidden = await db.prepare(`SELECT COUNT(*) AS n FROM (SELECT host FROM host_uses WHERE day >= ? GROUP BY host HAVING COUNT(DISTINCT install) < ?)`).bind(since, minInstalls).first();
  const sites = [];
  for (const row of rows) {
    const pairs = (await db.prepare(`SELECT DISTINCT h.install AS install, COALESCE(c.countries, '') AS countries FROM host_uses h LEFT JOIN contributions c
      ON c.install = h.install AND c.countries <> '' WHERE h.host = ? AND h.day >= ?`).bind(row.host, since).all()).results || [];
    const perInstall = new Map();
    for (const pair of pairs) {
      const list = perInstall.get(pair.install) || new Set();
      for (const country of String(pair.countries).split(',').filter(Boolean)) list.add(country);
      perInstall.set(pair.install, list);
    }
    const counts = new Map();
    for (const list of perInstall.values()) for (const country of list) counts.set(country, (counts.get(country) || 0) + 1);
    const known = [...counts].filter(([, installs]) => installs >= minInstalls).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([country, installs]) => ({country, installs}));
    const other = row.installs - known.reduce((sum, item) => sum + item.installs, 0);
    sites.push({host: row.host, installs: row.installs, uses: row.uses, ready: row.ready, countries: other > 0 ? [...known, {country: 'other', installs: other}] : known});
  }
  return {sites, hidden: {hosts: hidden?.n || 0}};
}

export const pruneHostUses = (db, now = new Date()) => db.prepare('DELETE FROM host_uses WHERE day < ?').bind(dayOf(new Date(now.getTime() - KEEP_DAYS * 86400000))).run();
