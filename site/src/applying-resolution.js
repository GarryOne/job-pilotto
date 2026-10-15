// /admin/lab-form-filling's Resolution tile, the page's headline (the outcome contract, owner 12 Oct 2026; spec docs/superpowers/specs/2026-10-12-one-next-move.md, phase 1a): every application
// ends in one fixed ending (extension/ladder/endings.js); this is each pool row's NEWEST ending, from the owner's Mac uploads of main's build (applying_runs.ending, on_main = 1: a
// branch's run never counts, migration 0061) and CI's pool runs on main
// (PUT /applying/endings, the narrow REPLAYS_PUBLISH_KEY, one row of the last 600 records), the share resolved raw and weighted by real demand (the scorecard's match share, with the
// rows each platform rests on), the rows held by the test apart (never measured), the unresolved rows first (the work list) and a weekly trend. A PR's run never counts here.
// The client code src/applying.js puts inside its page is in applying-resolution-view.js. Guard: test/applying-resolution.test.js.
import {CAUSES, ENDINGS, WORST_FIRST, resolved} from '../../extension/ladder/endings.js';
import {equal} from './guard.js';
import {dropSnapshot} from './applying-store.js';
import {RESOLUTION_CSS, RESOLUTION_SCRIPT} from './applying-resolution-view.js';

export {RESOLUTION_CSS, RESOLUTION_SCRIPT};
export const STEPS = ['none', 'posting', 'account', 'code/bot', 'form', 'ready'];   // where a run stopped (the page's step words)

export const ENDING_WORDS = [...ENDINGS, 'held'];   // 'held': the test's own hold (never an account button with fake data, a bot wall on a CI address)
const KEEP = 600, WEEKS = 6;
const text = (value, max) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const nameOf = value => { const name = text(value, 120); return name && !/[?=@]|:\/\/|https?:/i.test(name) ? name : null; };
const isoOf = value => { const time = Date.parse(text(value, 40)); return Number.isFinite(time) ? new Date(time).toISOString() : null; };
export const endingWord = value => (ENDING_WORDS.includes(value) ? value : null);
export const causeWord = value => (typeof value === 'string' && Object.hasOwn(CAUSES, value) ? value : null);   // fixed words only: never page text
const stepWord = value => (STEPS.includes(value) ? value : null);

export async function readEndings(db) {
  const row = await db.prepare("SELECT body FROM applying_endings WHERE key = 'all'").bind().first().catch(() => null);
  try { return row ? JSON.parse(row.body) : []; } catch { return []; }
}

// {records: [{row, ending, step?, cause?, run, branch, sha, at}]} -> {ok, stored}. Identical (run, row) records write nothing.
export async function storeEndings(db, body, now = new Date()) {
  const incoming = Array.isArray(body?.records) ? body.records.slice(0, 200) : [];
  if (!incoming.length) return {ok: false, error: 'records are required'};
  const fresh = [];
  for (const item of incoming) {
    const row = nameOf(item?.row), ending = endingWord(item?.ending), run = text(item?.run, 20), at = isoOf(item?.at);
    if (!row || !ending || !/^\d+$/.test(run) || !at) continue;
    fresh.push({row, ending, step: stepWord(item.step), cause: causeWord(item.cause), run, branch: text(item.branch, 80) || null, sha: /^[0-9a-f]{7,40}$/.test(text(item.sha, 40)) ? text(item.sha, 40) : null, at});
  }
  if (!fresh.length) return {ok: true, stored: 0};
  const kept = await readEndings(db), known = new Set(kept.map(item => `${item.run}\n${item.row}`)), added = fresh.filter(item => !known.has(`${item.run}\n${item.row}`));
  if (!added.length) return {ok: true, stored: 0};
  const next = [...kept, ...added].sort((a, b) => a.at.localeCompare(b.at)).slice(-KEEP);
  await db.prepare("INSERT INTO applying_endings (key, at, body) VALUES ('all', ?, ?) ON CONFLICT(key) DO UPDATE SET at = excluded.at, body = excluded.body").bind(now.toISOString(), JSON.stringify(next)).run();
  return {ok: true, stored: added.length};
}

// PUT /applying/endings. A wrong or missing key is a 404, as the replays and proven routes.
export async function endingsIngest(request, env, now = new Date()) {
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!(env.REPLAYS_PUBLISH_KEY && equal(given, env.REPLAYS_PUBLISH_KEY)) || !env.STATS) return new Response('Not found', {status: 404});
  const result = await storeEndings(env.STATS, await request.json().catch(() => null), now);
  if (result.ok && result.stored) await dropSnapshot(env.STATS);
  return Response.json(result, {status: result.ok ? 200 : 400, headers: {'Cache-Control': 'no-store'}});
}

// The Monday of a day's ISO week (UTC).
const weekOf = at => { const date = new Date(at); const back = (date.getUTCDay() + 6) % 7; return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - back)).toISOString().slice(0, 10); };
// Worst first: the order of the table. A row's change since its previous run: up (a better ending), down (a worse one), same, or none (no earlier run).
const RANK = WORST_FIRST;
const sinceOf = (was, now) => (!was ? null : was === now ? '=' : RANK.indexOf(now) < RANK.indexOf(was) ? '↓' : '↑');
const pct = (part, whole) => (whole ? Math.round((100 * part) / whole) : null);

// runs: the page's latest runs (applying_runs rows, each with `ending`); endings: CI's records; pool: the page's pool rows ({shape, platform}); scorecard: [{platform, matchShare}].
// -> {measured, held, resolved, raw, weighted, covered, samples, endings, unresolved, weeks}
export function resolution({runs = [], endings = [], pool = [], scorecard = [], now = new Date()} = {}) {
  const inPool = new Map(pool.map(item => [item.shape, item.platform || 'Custom']));
  const all = [...runs.filter(run => run.kind === 'smoke' && run.on_main === 1 && endingWord(run.ending)).map(run => ({row: run.name, ending: run.ending, at: run.at, source: 'mac', step: stepWord(run.reached), cause: causeWord(run.cause), run: null})),
    ...endings.filter(item => item.branch === 'main' && endingWord(item.ending)).map(item => ({row: item.row, ending: item.ending, at: item.at, source: 'ci', step: stepWord(item.step), cause: causeWord(item.cause), run: /^\d+$/.test(item.run || '') ? item.run : null}))]
    .filter(item => inPool.has(item.row) && isoOf(item.at) && Date.parse(item.at) <= now.getTime()).sort((a, b) => a.at.localeCompare(b.at));
  const before = new Map();   // each row's ending before its newest one
  for (const item of all) { const mine = before.get(item.row) || {last: null, prev: null}; mine.prev = mine.last; mine.last = item; before.set(item.row, mine); }
  const newest = list => [...list.reduce((out, item) => out.set(item.row, item), new Map()).values()];
  const latest = newest(all), measured = latest.filter(item => item.ending !== 'held');
  const counts = Object.fromEntries(ENDINGS.map(one => [one, measured.filter(item => item.ending === one).length]));
  const resolvedRows = measured.filter(item => resolved(item.ending)).length;
  // Weighted by real demand: each platform's share resolved times its match share; a platform with no measured row weighs nothing, and its sample is said beside the number.
  let sum = 0, covered = 0;
  const samples = [...scorecard].filter(item => Number(item.matchShare) > 0).sort((a, b) => b.matchShare - a.matchShare).map(item => {
    const mine = measured.filter(row => inPool.get(row.row) === item.platform);
    if (mine.length) { sum += item.matchShare * (mine.filter(row => resolved(row.ending)).length / mine.length); covered += item.matchShare; }
    return {platform: item.platform, share: item.matchShare, rows: mine.length};
  });
  const weeks = Object.entries(all.reduce((out, item) => ((out[weekOf(item.at)] ||= []).push(item), out), {})).sort(([a], [b]) => a.localeCompare(b)).slice(-WEEKS)
    .map(([week, list]) => { const rows = newest(list).filter(item => item.ending !== 'held'); return {week, measured: rows.length, raw: pct(rows.filter(item => resolved(item.ending)).length, rows.length)}; });
  return {measured: measured.length, held: latest.length - measured.length, resolved: resolvedRows, raw: pct(resolvedRows, measured.length), weighted: covered ? Math.round(sum / covered * 100) : null, covered, samples,
    endings: counts, unresolved: measured.filter(item => item.ending === 'unresolved').length,
    rows: latest.map(item => ({row: item.row, platform: inPool.get(item.row), ending: item.ending, step: item.step, cause: item.cause, source: item.source, run: item.run, day: item.at.slice(0, 10), since: sinceOf(before.get(item.row)?.prev?.ending, item.ending)}))
      .sort((a, b) => RANK.indexOf(a.ending) - RANK.indexOf(b.ending) || a.row.localeCompare(b.row)), weeks};
}
