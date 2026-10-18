// /admin/lab-job-search's data (owner, 18 Oct 2026): one row per candidate per replayed search, in D1 (migration 0095). Owns the row's shape and checks (fixed-length ids, counts and seconds,
// nothing free-form beyond a short label and the name of the step that crashed), the upload (PUT /search-lab/rows: Bearer REPLAYS_PUBLISH_KEY, main only, as src/applying-ci-rows.js) and the
// read. rowFromPress turns one line of tools/persona-search presses.jsonl into a row. Guard: test/search-lab.test.js.
import {equal} from './guard.js';

export const KEEP_RUNS = 30;   // runs kept per candidate
const MAX_ROWS = 20;
// ok = a clean replay; failed = a step crashed; stale = the tape lacks requests this build makes (src/search-lab-judge.js).
const STATES = ['ok', 'failed', 'stale'];
const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const BUILD = /^[0-9a-f]{7,40}$/;
const WHEN = /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?Z$/;
export const FIELDS = ['first_s', 'tenth_s', 'fit_s', 'in_places', 'scored', 'fit70'];

const count = value => (value == null ? null : Number.isInteger(value) && value >= 0 && value <= 1e7 ? value : undefined);
const text = (value, max) => String(value ?? '').replace(/[^\p{L}\p{N} ·.,()'-]/gu, '').trim().slice(0, max);

// The row as stored, or {error} naming the first thing wrong.
export function clean(row) {
  if (!row || typeof row !== 'object') return {error: 'a row is an object'};
  if (!NAME.test(row.candidate || '')) return {error: 'candidate: a short lower-case id'};
  if (!WHEN.test(row.run_at || '')) return {error: `${row.candidate}: run_at is a UTC time`};
  if (row.build != null && !BUILD.test(row.build)) return {error: `${row.candidate}: build is a git sha`};
  if (!STATES.includes(row.state)) return {error: `${row.candidate}: state is ok, failed or stale`};
  const out = {candidate: row.candidate, run_at: row.run_at, build: row.build ?? null, label: text(row.label, 60) || row.candidate, control: row.control ? 1 : 0, state: row.state,
    failed_step: row.state === 'ok' ? null : text(row.failed_step, 90) || 'unknown step'};
  for (const field of FIELDS) {
    const value = count(row[field]);
    if (value === undefined) return {error: `${row.candidate}: ${field} is a count or null`};
    out[field] = value;
  }
  return out;
}

export async function ingest(db, rows, now = new Date()) {
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_ROWS) return {ok: false, error: `send 1 to ${MAX_ROWS} rows`};
  const clear = rows.map(clean), bad = clear.find(row => row.error);
  if (bad) return {ok: false, error: bad.error};
  for (const row of clear) {
    await db.prepare(`INSERT OR REPLACE INTO search_lab_runs (candidate, run_at, build, label, control, state, ${FIELDS.join(', ')}, failed_step) VALUES (?, ?, ?, ?, ?, ?, ${FIELDS.map(() => '?').join(', ')}, ?)`)
      .bind(row.candidate, row.run_at, row.build, row.label, row.control, row.state, ...FIELDS.map(field => row[field]), row.failed_step).run();
    await db.prepare('DELETE FROM search_lab_runs WHERE candidate = ? AND run_at NOT IN (SELECT run_at FROM search_lab_runs WHERE candidate = ? ORDER BY run_at DESC LIMIT ?)')
      .bind(row.candidate, row.candidate, KEEP_RUNS).run();
  }
  return {ok: true, stored: clear.length, at: now.toISOString()};
}

export async function ingestRoute(request, env, now = new Date()) {
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!(env.REPLAYS_PUBLISH_KEY && equal(given, env.REPLAYS_PUBLISH_KEY)) || !env.STATS) return new Response('Not found', {status: 404});
  const body = await request.json().catch(() => null);
  const result = body?.branch === 'main' ? await ingest(env.STATS, body.rows, now) : {ok: false, error: 'only a run on main reaches the page'};   // a branch's work in progress once showed main as broken
  return Response.json(result, {status: result.ok ? 200 : 400, headers: {'Cache-Control': 'no-store'}});
}

// Every kept run, oldest first per candidate.
export async function runs(db) {
  const {results} = await db.prepare('SELECT * FROM search_lab_runs ORDER BY candidate, run_at LIMIT 1000').all();
  return results || [];
}

// One line of tools/persona-search/presses.jsonl (press 1) -> a row. `crashes` non-empty = the search's step died: FAILED, never thin numbers. `stale` (a sentence from
// tools/persona-search/tape-store.mjs staleNote) = the tape lacks what this build asks: Tape stale, numbers shown but never judged.
export function rowFromPress(candidate, press, {label, control = false, build, runAt}) {
  const ttfr = press.ttfr || {}, crash = (press.crashes || [])[0];
  return {candidate, run_at: runAt, build, label, control, state: crash ? 'failed' : press.stale ? 'stale' : 'ok', failed_step: crash?.step || press.stale,
    first_s: ttfr.first_in_places_s ?? null, tenth_s: ttfr.tenth_in_places_s ?? null, fit_s: ttfr.first_fit70_s ?? null,
    in_places: press.in_places ?? null, scored: press.scored_in_places ?? null, fit70: press.fit70_in_places ?? null};
}
