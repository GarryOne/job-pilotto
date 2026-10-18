// The Random draws tab's data (owner, 18 Oct 2026; tools/persona-search/draw.py): one row per daily CI draw, checked on the way in (fixed shapes, counts and seconds, no free text), uploaded with
// PUT /search-lab/draws (Bearer REPLAYS_PUBLISH_KEY, main only), read back newest first, and judged: FAILED (a step crashed), Weak (no 1st relevant job, fewer than WEAK_FLOOR jobs in places, or under
// half of the role family's median once MIN_HISTORY earlier draws exist), else Usual. Guard: test/search-lab-draws.test.js.
import {equal} from './guard.js';

export const KEEP_DRAWS = 400, WEAK_FLOOR = 10, MIN_HISTORY = 5;
const FIELDS = ['first_s', 'tenth_s', 'fit_s', 'in_places', 'scored', 'fit70'];
const DAY = /^\d{4}-\d\d-\d\d$/, ID = /^[a-z0-9][a-z0-9-]{0,39}$/, BUILD = /^[0-9a-f]{7,40}$/;
const text = (value, max) => String(value ?? '').replace(/[^\p{L}\p{N} .'-]/gu, '').trim().slice(0, max);
const count = value => (value == null ? null : Number.isInteger(value) && value >= 0 && value <= 1e7 ? value : undefined);

export function clean(row) {
  if (!row || typeof row !== 'object') return {error: 'a draw is an object'};
  if (!DAY.test(row.draw_date || '')) return {error: 'draw_date is YYYY-MM-DD'};
  if (!ID.test(row.family || '')) return {error: `${row.draw_date}: family is a short lower-case id`};
  if (row.build != null && !BUILD.test(row.build)) return {error: `${row.draw_date}: build is a git sha`};
  if (row.state !== 'ok' && row.state !== 'failed') return {error: `${row.draw_date}: state is ok or failed`};
  const out = {draw_date: row.draw_date, seed: text(row.seed, 40) || row.draw_date, family: row.family, city: text(row.city, 40), country: text(row.country, 40),
    source: 'ci', build: row.build ?? null, state: row.state, failed_step: row.state === 'failed' ? text(row.failed_step, 60) || 'unknown step' : null};
  if (!out.city || !out.country) return {error: `${row.draw_date}: city and country are short names`};
  for (const field of FIELDS) {
    const value = count(row[field]);
    if (value === undefined) return {error: `${row.draw_date}: ${field} is a count or null`};
    out[field] = value;
  }
  return out;
}

export async function ingest(db, row, now = new Date()) {
  const clear = clean(row);
  if (clear.error) return {ok: false, error: clear.error};
  await db.prepare(`INSERT OR REPLACE INTO search_lab_draws (draw_date, seed, family, city, country, source, build, state, ${FIELDS.join(', ')}, failed_step) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${FIELDS.map(() => '?').join(', ')}, ?)`)
    .bind(clear.draw_date, clear.seed, clear.family, clear.city, clear.country, clear.source, clear.build, clear.state, ...FIELDS.map(field => clear[field]), clear.failed_step).run();
  await db.prepare('DELETE FROM search_lab_draws WHERE draw_date NOT IN (SELECT draw_date FROM search_lab_draws ORDER BY draw_date DESC LIMIT ?)').bind(KEEP_DRAWS).run();
  return {ok: true, stored: 1, at: now.toISOString()};
}

export async function ingestRoute(request, env, now = new Date()) {
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!(env.REPLAYS_PUBLISH_KEY && equal(given, env.REPLAYS_PUBLISH_KEY)) || !env.STATS) return new Response('Not found', {status: 404});
  const body = await request.json().catch(() => null);
  const result = body?.branch === 'main' ? await ingest(env.STATS, body.draw, now) : {ok: false, error: 'only a run on main reaches the page'};
  return Response.json(result, {status: result.ok ? 200 : 400, headers: {'Cache-Control': 'no-store'}});
}

export async function draws(db) {
  const {results} = await db.prepare('SELECT * FROM search_lab_draws ORDER BY draw_date DESC LIMIT 400').all();
  return results || [];
}

const median = values => { const sorted = [...values].sort((a, b) => a - b), mid = sorted.length >> 1; return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2; };

// Newest first in, same order out with {state: 'failed'|'weak'|'usual', why: [...]}. A draw is compared with the same family's EARLIER draws only.
export function judge(rows) {
  return rows.map(row => {
    if (row.state === 'failed') return {...row, verdict: 'failed', why: [`a step crashed: ${row.failed_step || 'unknown step'}`]};
    const why = [], before = rows.filter(other => other.family === row.family && other.draw_date < row.draw_date && other.state === 'ok');
    if (row.first_s == null) why.push('no relevant job reached');
    if ((row.in_places ?? 0) < WEAK_FLOOR) why.push(`only ${row.in_places ?? 0} jobs in the places (under ${WEAK_FLOOR})`);
    if (before.length >= MIN_HISTORY) {
      const usual = median(before.map(other => other.in_places ?? 0));
      if ((row.in_places ?? 0) < usual / 2) why.push(`jobs in places ${row.in_places ?? 0}, this role's usual ${usual}`);
    }
    return {...row, verdict: why.length ? 'weak' : 'usual', why};
  });
}

// One line of tools/persona-search/presses.jsonl (press 1) plus draw.json -> the row to upload.
export function rowFromDraw(info, press, {build}) {
  const ttfr = press.ttfr || {}, crash = (press.crashes || [])[0];
  return {draw_date: info.seed, seed: info.seed, family: info.family, city: info.city, country: info.country, build, state: crash ? 'failed' : 'ok', failed_step: crash?.step,
    first_s: ttfr.first_in_places_s ?? null, tenth_s: ttfr.tenth_in_places_s ?? null, fit_s: ttfr.first_fit70_s ?? null,
    in_places: press.in_places ?? null, scored: press.scored_in_places ?? null, fit70: press.fit70_in_places ?? null};
}
