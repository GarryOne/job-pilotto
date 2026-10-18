// The ladder's learned moves per page shape (spec docs/superpowers/specs/2026-10-12-one-next-move.md, phase 1): what a page CONFIRMED of a decision (the form came after the press, the
// fill took values), counted per shape, decision and SOURCE. 'user': an install's learning batch (POST /api/controls `ladder`, desktop/lib/recipes.js); 'ci' (the CI pool,
// desktop/e2e/pool-moves.mjs) and 'replay' (the recorded pages on main, desktop/e2e/replays-report.mjs): accepted only with CI's narrow key (REPLAYS_PUBLISH_KEY) or the owner's, so test
// data never poses as a user's. Fixed values and integers only, as desktop/lib/ladder/learning.js counts() (its lists are checked equal to these by desktop/test/ladder-moves-site.test.js).
// Not served to installs yet: the pack's k>=3 rule comes with phase 3. GET /api/ladder-moves (owner): every move, each source apart. Guard: test/ladder-moves.test.js.
import {isOwner} from './stats.js';
import {readRepairs} from './repair-evidence.js';

export const SOURCES = ['user', 'ci', 'replay'];
export const KINDS = ['form', 'account-form', 'account', 'posting', 'closed', 'other'];
export const OUTCOMES = ['form', 'email', 'phone', 'link', 'login_wall', 'refused', 'expired', 'in_person', 'other'];
export const SHAPE = /^[a-z0-9._-]{1,80}(\/[a-z0-9._*-]{0,60}){0,8}\|[a-z0-9+-]{1,12}$/;
const MAX_ROWS = 200, count = value => (Number.isInteger(value) && value >= 0 ? Math.min(value, 1e6) : null);
const day = date => date.toISOString().slice(0, 10);

// -> {shape, rung, kind, outcome, hits, misses} or null. A row that confirmed and missed nothing says nothing.
export function cleanMove(raw) {
  const hits = count(raw?.hits), misses = count(raw?.misses), kind = raw?.kind ?? '';
  if (!SHAPE.test(String(raw?.shape ?? '')) || !Number.isInteger(raw?.rung) || raw.rung < 0 || raw.rung > 6 || !OUTCOMES.includes(raw?.outcome) || !(kind === '' || KINDS.includes(kind))
    || hits === null || misses === null || hits + misses === 0) return null;
  return {shape: raw.shape, rung: raw.rung, kind, outcome: raw.outcome, hits, misses};
}

// rows from one batch; source and who are the caller's (who: the hashed install, 'ci:<run>' or 'replay'). A user's counts add up; a test run's are written once (a re-send adds nothing). -> stored
export async function storeMoves(db, rows, {source, who, now = new Date()} = {}) {
  if (!db || !SOURCES.includes(source) || !/^[\w:-]{1,60}$/.test(String(who || ''))) return 0;
  let stored = 0;
  for (const move of (Array.isArray(rows) ? rows : []).slice(0, MAX_ROWS).map(cleanMove).filter(Boolean)) {
    const values = [move.shape, move.rung, move.kind, move.outcome, source, who, move.hits, move.misses, day(now), day(now)];
    const insert = 'INSERT INTO ladder_moves (shape, rung, kind, outcome, source, who, hits, misses, first_day, last_day) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
    const done = await db.prepare(source === 'user' ? `${insert} ON CONFLICT (shape, rung, kind, outcome, source, who) DO UPDATE SET hits = hits + excluded.hits, misses = misses + excluded.misses, last_day = excluded.last_day`
      : insert.replace('INSERT INTO', 'INSERT OR IGNORE INTO')).bind(...values).run().catch(() => null);
    stored += (done?.meta?.changes ?? done?.changes ?? 0) > 0 ? 1 : 0;
  }
  return stored;
}

// Every move, per shape and decision, each source apart: {n (installs or runs), hits, misses}.
export async function readMoves(db) {
  const found = (await db.prepare(`SELECT shape, rung, kind, outcome, source, COUNT(DISTINCT who) AS n, SUM(hits) AS hits, SUM(misses) AS misses, MAX(last_day) AS last_day
    FROM ladder_moves GROUP BY shape, rung, kind, outcome, source ORDER BY shape, rung`).all().catch(() => ({results: []}))).results || [];
  const moves = new Map();
  for (const row of found) {
    const key = [row.shape, row.rung, row.kind, row.outcome].join('\n');
    const move = moves.get(key) || {shape: row.shape, rung: row.rung, kind: row.kind, outcome: row.outcome, last_day: row.last_day, ...Object.fromEntries(SOURCES.map(source => [source, {n: 0, hits: 0, misses: 0}]))};
    move[row.source] = {n: row.n, hits: row.hits, misses: row.misses};
    if (row.last_day > move.last_day) move.last_day = row.last_day;
    moves.set(key, move);
  }
  return [...moves.values()];
}

// GET /api/ladder-moves (the owner's key): the moves and how many shapes each source confirmed. Anyone else: 404.
export async function movesView(request, env) {
  if (!env.STATS || !(await isOwner(request, env))) return new Response('Not found', {status: 404});
  const moves = await readMoves(env.STATS);
  const totals = {shapes: new Set(moves.map(move => move.shape)).size, ...Object.fromEntries(SOURCES.map(source => [source, new Set(moves.filter(move => move[source].n).map(move => move.shape)).size]))};
  const repairs = await readRepairs(env.STATS);   // what the control repairs did per fingerprint and verb (src/repair-evidence.js)
  return Response.json({ok: true, totals, moves, repairs}, {headers: {'Cache-Control': 'private, no-store'}});
}
