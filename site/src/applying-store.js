// The read budget of /admin/lab-form-filling (D1's free plan counts every row a query reads: 11 Oct 2026 the page alone read 4M of 5M rows a day). Owns: applying_latest (each site's last
// runs as ONE row, rewritten when a run is uploaded or forgotten, so the page never scans applying_runs) and applying_view (computed snapshots: the page's data, and the big readers
// behind it, served until they expire; an upload drops the page's snapshot). Guard: test/applying-budget.test.js.
export const KEEP_RUNS = 30;       // runs kept per (kind, name); the page shows the last 20, and the nights are counted from them
export const FAST_MINUTES = 10;    // the page's data
export const SLOW_MINUTES = 60;    // the big readers (contributions, fill cards, the digest)

const missing = error => console.warn('migration 0056 missing (applying_latest / applying_view): computing without the snapshot: ' + String(error?.message || error).slice(0, 120));
const minutesSince = (at, now) => (now.getTime() - Date.parse(at)) / 60000;

// Rewrites the last runs of each given {kind, name} from applying_runs (an indexed lookup of at most KEEP_RUNS rows each, one row written).
export async function refreshLatest(db, pairs) {
  try { await writeLatest(db, pairs); } catch (error) { missing(error); }   // a failed migration must not refuse an upload
}
async function writeLatest(db, pairs) {
  const seen = new Set();
  for (const {kind, name} of pairs) {
    if (seen.has(kind + '\n' + name)) continue;
    seen.add(kind + '\n' + name);
    const rows = (await db.prepare('SELECT * FROM applying_runs WHERE kind = ? AND name = ? ORDER BY day DESC, id DESC LIMIT ?').bind(kind, name, KEEP_RUNS).all()).results || [];
    if (!rows.length) await db.prepare('DELETE FROM applying_latest WHERE kind = ? AND name = ?').bind(kind, name).run();
    else await db.prepare('INSERT INTO applying_latest (kind, name, runs) VALUES (?, ?, ?) ON CONFLICT(kind, name) DO UPDATE SET runs = excluded.runs').bind(kind, name, JSON.stringify(rows.reverse())).run();
  }
}

// Every site's and case's last runs, oldest first, from applying_latest. An empty table (before the first upload after this change) is filled once from applying_runs.
export async function latestRuns(db, since = '0000-00-00') {
  try { return await readLatest(db); } catch (error) {
    missing(error);
    return (await db.prepare('SELECT * FROM applying_runs WHERE day >= ? ORDER BY day, id').bind(since).all()).results || [];   // the old full scan, until the table exists
  }
}
async function readLatest(db) {
  let rows = (await db.prepare('SELECT runs FROM applying_latest').all()).results || [];
  if (!rows.length) {
    const pairs = (await db.prepare("SELECT DISTINCT kind, name FROM applying_runs WHERE kind IN ('smoke', 'recorded')").all()).results || [];
    if (pairs.length) { await refreshLatest(db, pairs); rows = (await db.prepare('SELECT runs FROM applying_latest').all()).results || []; }
  }
  return rows.flatMap(row => { try { return JSON.parse(row.runs); } catch { return []; } }).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.id - b.id));
}

// The page's data is computed at most every FAST_MINUTES, and again after an upload dropped it. cachedJson returns the JSON TEXT as stored (only the trailing "now" is replaced):
// no parse and no stringify on a warm load, the free plan allows 10 ms of CPU a request. cachedData is the parsed form.
const withNow = (body, now) => { const at = body.lastIndexOf('"now":"'); return at < 0 ? body : body.slice(0, at) + '"now":"' + now.toISOString() + '"}'; };
export async function cachedJson(db, compute, now = new Date()) {
  const row = await db.prepare("SELECT at, body FROM applying_view WHERE key = 'fast'").bind().first().catch(error => (missing(error), null));
  if (row && minutesSince(row.at, now) < FAST_MINUTES) return withNow(row.body, now);
  const body = JSON.stringify(await compute());
  await db.prepare("INSERT INTO applying_view (key, at, body) VALUES ('fast', ?, ?) ON CONFLICT(key) DO UPDATE SET at = excluded.at, body = excluded.body").bind(now.toISOString(), body).run().catch(missing);
  return body;
}
export const cachedData = async (db, compute, now = new Date()) => JSON.parse(await cachedJson(db, compute, now));
export const dropSnapshot = db => db.prepare("DELETE FROM applying_view WHERE key = 'fast'").bind().run().catch(missing);

// A big reader's result kept SLOW_MINUTES: slow(db, now)(key, fn) -> fn's JSON result.
export const slowCache = (db, now = new Date()) => async (key, fn) => {
  const row = await db.prepare('SELECT at, body FROM applying_view WHERE key = ?').bind('slow:' + key).first().catch(error => (missing(error), null));
  if (row && minutesSince(row.at, now) < SLOW_MINUTES) { try { return JSON.parse(row.body); } catch { /* recompute */ } }
  const fresh = await fn();
  await db.prepare('INSERT INTO applying_view (key, at, body) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET at = excluded.at, body = excluded.body').bind('slow:' + key, now.toISOString(), JSON.stringify(fresh)).run().catch(missing);
  return fresh;
};
