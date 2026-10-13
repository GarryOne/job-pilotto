// What the fill ladder's control repairs did, counted per control fingerprint and verb (spec docs/superpowers/specs/2026-10-12-fill-ladder.md, PR D2): the batch's `repairs`
// ([{fp, verb, ok, failed}], fixed values and integers only: desktop/lib/ladder/repair-kept.js counts() from an install, desktop/e2e/lib/ladder-moves.mjs from the CI pool and the replays),
// stored per SOURCE like the ladder's moves (src/ladder-moves.js): 'user' adds up per install, a test run's are written once. A fingerprint seen by >= 3 installs is a fixed row
// (K_MIN); serving it to installs comes later. GET /api/ladder-moves (the owner) shows them. Guard: test/repair-evidence.test.js.
export const SOURCES = ['user', 'ci', 'replay'];   // the same list as src/ladder-moves.js (its guard checks them equal; no import, so that file can show these rows)
export const K_MIN = 3;
const MAX_ROWS = 200, FP = /^[a-z0-9]{6,16}$/, VERB = /^[a-z_]{2,24}$/;
const count = value => (Number.isInteger(value) && value >= 0 ? Math.min(value, 1e6) : null);
const day = date => date.toISOString().slice(0, 10);

// -> {fp, verb, ok, failed} or null. A row that worked and failed zero times says nothing.
export function cleanRepair(raw) {
  const ok = count(raw?.ok), failed = count(raw?.failed);
  if (!FP.test(String(raw?.fp ?? '')) || !VERB.test(String(raw?.verb ?? '')) || ok === null || failed === null || ok + failed === 0) return null;
  return {fp: raw.fp, verb: raw.verb, ok, failed};
}

// rows from one batch; source and who are the caller's (as storeMoves). -> how many rows were stored
export async function storeRepairs(db, rows, {source, who, now = new Date()} = {}) {
  if (!db || !SOURCES.includes(source) || !/^[\w:-]{1,60}$/.test(String(who || ''))) return 0;
  let stored = 0;
  for (const row of (Array.isArray(rows) ? rows : []).slice(0, MAX_ROWS).map(cleanRepair).filter(Boolean)) {
    const values = [row.fp, row.verb, source, who, row.ok, row.failed, day(now), day(now)];
    const insert = 'INSERT INTO repair_evidence (fp, verb, source, who, ok, failed, first_day, last_day) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
    const done = await db.prepare(source === 'user' ? `${insert} ON CONFLICT (fp, verb, source, who) DO UPDATE SET ok = ok + excluded.ok, failed = failed + excluded.failed, last_day = excluded.last_day`
      : insert.replace('INSERT INTO', 'INSERT OR IGNORE INTO')).bind(...values).run().catch(() => null);
    stored += (done?.meta?.changes ?? done?.changes ?? 0) > 0 ? 1 : 0;
  }
  return stored;
}

// Every repair per fingerprint and verb, each source apart: {n (installs or runs), ok, failed}; `fixed` when >= K_MIN installs used it.
export async function readRepairs(db) {
  const found = (await db.prepare(`SELECT fp, verb, source, COUNT(DISTINCT who) AS n, SUM(ok) AS ok, SUM(failed) AS failed, MAX(last_day) AS last_day
    FROM repair_evidence GROUP BY fp, verb, source ORDER BY fp, verb`).all().catch(() => ({results: []}))).results || [];
  const rows = new Map();
  for (const row of found) {
    const key = `${row.fp}\n${row.verb}`;
    const entry = rows.get(key) || {fp: row.fp, verb: row.verb, last_day: row.last_day, ...Object.fromEntries(SOURCES.map(source => [source, {n: 0, ok: 0, failed: 0}]))};
    entry[row.source] = {n: row.n, ok: row.ok, failed: row.failed};
    if (row.last_day > entry.last_day) entry.last_day = row.last_day;
    rows.set(key, entry);
  }
  return [...rows.values()].map(entry => ({...entry, fixed: entry.user.n >= K_MIN}));
}
