// /admin/lab-form-filling's Fixed-site replays: the recorded pages replayed by CI on main after each merge (.github/workflows/page-cases.yml, desktop/e2e/replays-report.mjs),
// never a local run (12 Oct 2026: fixers' work-in-progress branches and a loaded Mac showed main as broken). PUT /applying/replays (Bearer REPLAYS_PUBLISH_KEY) writes
// ONE row with the last 10 runs (the D1 free plan: 11 Oct 2026); the page reads that one row. Names, a short note and the build's sha only. Guard: test/applying-replays.test.js.
import {dropSnapshot} from './applying-store.js';
import {equal} from './guard.js';
import {ORIGINS} from '../../desktop/e2e/lib/recorded-origin.mjs';

const KEEP = 10;
const HASH = /^[0-9a-f]{7,40}$/;
const text = (value, max) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const nameOf = value => { const name = text(value, 120); return name && !/[?=@]|:\/\/|https?:/i.test(name) ? name : null; };
const rungOf = value => (Number.isInteger(value) && value >= 0 && value <= 6 ? value : null);

// -> the stored runs, oldest first ([] before the first upload).
export async function readReplays(db) {
  const row = await db.prepare("SELECT body FROM applying_replays WHERE key = 'main'").bind().first().catch(() => null);
  try { return row ? JSON.parse(row.body) : []; } catch { return []; }
}

// One CI run in: {sha, version?, rows: [{name, ok, rung?, note?, origin?}]} (origin: 'captured' from a real page or 'hand-cut', desktop/e2e/lib/recorded-origin.mjs). A re-run of the same sha replaces its run; identical results write nothing. -> {ok, stored} | {ok: false, error}
export async function storeReplays(db, body, now = new Date()) {
  const sha = text(body?.sha, 40).toLowerCase(), rows = Array.isArray(body?.rows) ? body.rows.slice(0, 500) : [];
  if (!HASH.test(sha) || !rows.length) return {ok: false, error: 'sha and rows are required'};
  const cases = {};
  for (const row of rows) { const name = nameOf(row?.name); if (name) cases[name] = [row.ok ? 1 : 0, rungOf(row.rung), row.ok ? '' : text(row.note, 200), ORIGINS.includes(row.origin) ? row.origin : null]; }
  if (!Object.keys(cases).length) return {ok: false, error: 'no valid rows'};
  const runs = await readReplays(db), last = runs.at(-1);
  const count = value => (Number.isInteger(value) && value >= 0 && value <= 5000 ? value : null);   // what the repo holds to test with, counted by structure by CI (desktop/e2e/lib/repo-counts.mjs)
  const repo = body?.repo && typeof body.repo === 'object' ? {recorded: count(body.repo.recorded), zoo: count(body.repo.zoo)} : null;
  if (last?.sha === sha && JSON.stringify(last.cases) === JSON.stringify(cases) && JSON.stringify(last.repo || null) === JSON.stringify(repo)) return {ok: true, stored: Object.keys(cases).length};
  const run = {sha, at: now.toISOString(), version: text(body.version, 20) || null, cases, ...(repo ? {repo} : {})};
  const next = [...(last?.sha === sha ? runs.slice(0, -1) : runs), run].slice(-KEEP);
  await db.prepare('INSERT INTO applying_replays (key, at, body) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET at = excluded.at, body = excluded.body').bind('main', run.at, JSON.stringify(next)).run();
  return {ok: true, stored: Object.keys(cases).length};
}

// The page's rows: every case in the LAST run (a case that left main is gone), with that run's sha and time, its last 10 results and the run since which it holds.
export function replayCases(runs) {
  const last = runs.at(-1);
  if (!last) return [];
  return Object.entries(last.cases).map(([name, [ok, rung, note, origin]]) => {
    const seen = runs.filter(run => run.cases[name]);
    let from = seen.length - 1;
    while (from > 0 && seen[from - 1].cases[name][0] === ok) from -= 1;
    return {name, ok: !!ok, rung, note: note || null, origin: ORIGINS.includes(origin) ? origin : null, sha: last.sha, at: last.at, day: last.at.slice(0, 10), version: last.version,
      history: seen.map(run => run.cases[name][0]), since: {sha: seen[from].sha, at: seen[from].at}};
  }).sort((a, b) => Number(a.ok) - Number(b.ok) || a.name.localeCompare(b.name));
}

// PUT /applying/replays. A wrong or missing key is a 404, as the other publish keys (src/jobcost.js).
export async function replaysIngest(request, env, now = new Date()) {
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!(env.REPLAYS_PUBLISH_KEY && equal(given, env.REPLAYS_PUBLISH_KEY)) || !env.STATS) return new Response('Not found', {status: 404});
  const result = await storeReplays(env.STATS, await request.json().catch(() => null), now);
  if (result.ok) await dropSnapshot(env.STATS);   // the page's snapshot is recomputed on the next view
  return Response.json(result, {status: result.ok ? 200 : 400, headers: {'Cache-Control': 'no-store'}});
}
