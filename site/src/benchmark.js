// /admin/benchmark-form-filling: how our form filling compares with other tools on the same fixed forms (owner, 15 Oct 2026). The bake-off (a private repo) sends each scored run once
// (PUT /benchmark/data, Bearer SELFHEAL_PUBLISH_KEY); the site keeps one row per run (benchmark_runs) and, after each write, ONE snapshot row (benchmark_snapshot) the page reads: no table scan per
// page load (D1 free plan). Tool, form and build names are data from the owner-only write; none is written in this code. Pure maths: src/benchmark-data.js; the page: src/benchmark-page.js.
import {viewer} from './auth.js';
import {equal} from './guard.js';
import {remember} from './stats.js';
import {APPLICANTS, FIX_KEYS, MODES, summarize} from './benchmark-data.js';
import {page} from './benchmark-page.js';

const KEEP_DAYS = 120, MAX_ROWS = 300;
const authorized = (request, env) => {
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  return Boolean(env.SELFHEAL_PUBLISH_KEY && equal(given, env.SELFHEAL_PUBLISH_KEY));
};
const count = value => (Number.isInteger(value) && value >= 0 && value <= 1000 ? value : null);
const text = (value, max) => String(value ?? '').trim().slice(0, max);

// One run in the shape the table holds, or null when it is not a run (a bad row is dropped, never stored half).
export function clean(run) {
  const row = {id: text(run?.id, 80), at: text(run?.at, 30), applicant: run?.applicant ?? 'thin', mode: run?.ours ? run?.mode ?? 'unknown' : 'any', tool: text(run?.tool, 60), ours: run?.ours ? 1 : 0, build: text(run?.build, 20), form: text(run?.form, 30), heldout: run?.heldout ? 1 : 0, fixes: [...new Set([...(Array.isArray(run?.fixes) ? run.fixes : []), ...(run?.oldTrail ? ['trail'] : [])])].filter(key => FIX_KEYS.includes(key)).join(',')};
  const numbers = Object.fromEntries(['required', 'right', 'wrong', 'empty', 'unans', 'holds', 'dups'].map(key => [key, count(run?.[key] ?? 0)]));
  if (!row.id || !/^\d{4}-\d{2}-\d{2}/.test(row.at) || !row.tool || !row.form || !APPLICANTS.includes(row.applicant) || !(row.mode === 'any' || MODES.includes(row.mode)) || Object.values(numbers).includes(null)) return null;
  if (numbers.right + numbers.wrong + numbers.empty > numbers.required + 5) return null;
  return {...row, ...numbers};
}

export async function buildSnapshot(db, now = new Date()) {
  const {results = []} = await db.prepare('SELECT * FROM benchmark_runs ORDER BY at').all();
  return {...summarize(results.map(row => ({...row}))), at: now.toISOString()};
}

// PUT /benchmark/data {runs: [run]}: each run once (the same id replaces its row); then the snapshot is rebuilt.
export async function ingest(request, env, now = new Date()) {
  if (!authorized(request, env) || request.method !== 'PUT') return new Response('Not found', {status: 404});
  const body = await request.text();
  if (body.length > 300000) return new Response('Too large', {status: 413});
  let data;
  try { data = JSON.parse(body); } catch { return new Response('Not JSON', {status: 400}); }
  if (!Array.isArray(data?.runs) || data.runs.length > MAX_ROWS) return new Response('Unexpected shape', {status: 400});
  const rows = data.runs.map(clean).filter(Boolean);
  const write = env.STATS.prepare(`INSERT INTO benchmark_runs (id, at, applicant, mode, tool, ours, build, form, heldout, fixes, required, right, wrong, empty, unans, holds, dups) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET at = excluded.at, applicant = excluded.applicant, mode = excluded.mode, tool = excluded.tool, ours = excluded.ours, build = excluded.build, form = excluded.form, heldout = excluded.heldout, fixes = excluded.fixes, required = excluded.required,
    right = excluded.right, wrong = excluded.wrong, empty = excluded.empty, unans = excluded.unans, holds = excluded.holds, dups = excluded.dups`);
  if (rows.length) await env.STATS.batch(rows.map(r => write.bind(r.id, r.at, r.applicant, r.mode, r.tool, r.ours, r.build, r.form, r.heldout, r.fixes, r.required, r.right, r.wrong, r.empty, r.unans, r.holds, r.dups)));
  await env.STATS.prepare('DELETE FROM benchmark_runs WHERE at < ?').bind(new Date(now.getTime() - KEEP_DAYS * 86400000).toISOString().slice(0, 10)).run();
  const snapshot = await buildSnapshot(env.STATS, now);
  await env.STATS.prepare('INSERT INTO benchmark_snapshot (id, at, body) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET at = excluded.at, body = excluded.body').bind(snapshot.at, JSON.stringify(snapshot)).run();
  return new Response(JSON.stringify({ok: true, stored: rows.length, ignored: data.runs.length - rows.length}), {headers: {'Content-Type': 'application/json'}});
}

export async function view(request, env) {
  if (!await viewer(request, env)) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  if (url.searchParams.has('key')) return remember(url, env, request);
  let snapshot = null;
  try { const row = env.STATS ? await env.STATS.prepare('SELECT body FROM benchmark_snapshot WHERE id = 1').first() : null; snapshot = row ? JSON.parse(row.body) : null; } catch { snapshot = null; }
  return new Response(page(snapshot, {segment: url.searchParams.get('view') || undefined}), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});
}
