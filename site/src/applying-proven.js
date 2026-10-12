// "Proven live" for /admin/applying's Fixed tab (owner, 12 Oct 2026): a merged fix is only proven when a CI run REALLY ran its pool row (reached a page; not skipped, not NOT RUN,
// not a bot wall on the runner's IP). CI sends one record per such run: PUT /applying/proven, Bearer REPLAYS_PUBLISH_KEY (the key that can only write the replay and these
// records, and reads nothing), stored as ONE row with the last 100 records (the D1 free plan). Names, shas, a PR number and commit subjects only: never an address.
// The join: main at or after the fix's landing, or the PR's own build matched by commit SUBJECT AND ROW (rebase-merge changes shas; two PRs with one subject cannot prove each
// other). Guard: test/applying-proven.test.js.
import {dropSnapshot} from './applying-store.js';
import {equal} from './guard.js';

const KEEP = 100;
const text = (value, max) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const nameOf = value => { const name = text(value, 120); return name && !/[?=@]|:\/\/|https?:/i.test(name) ? name : null; };
const HASH = /^[0-9a-f]{7,40}$/;
// Reached a page the extension decided on: a posting, an account page or the form. A bot wall (code/bot) or nothing is no proof.
const REAL = new Set(['posting', 'account', 'form', 'ready']);
const isoOf = value => { const time = Date.parse(text(value, 40)); return Number.isFinite(time) ? new Date(time).toISOString() : null; };

export async function readProven(db) {
  const row = await db.prepare("SELECT body FROM applying_proven WHERE key = 'main'").bind().first().catch(() => null);
  try { return row ? JSON.parse(row.body) : []; } catch { return []; }
}

// {records: [{row, sha, branch, pr, subjects, reached, applicant, run, at}]} -> {ok, stored}. Identical records write nothing (a re-sent upload).
export async function storeProven(db, body, now = new Date()) {
  const incoming = Array.isArray(body?.records) ? body.records.slice(0, 20) : [];
  if (!incoming.length) return {ok: false, error: 'records are required'};
  const fresh = [];
  for (const item of incoming) {
    const row = nameOf(item?.row), sha = text(item?.sha, 40).toLowerCase(), at = isoOf(item?.at), run = text(item?.run, 20), reached = text(item?.reached, 20);
    if (!row || !HASH.test(sha) || !at || !/^\d+$/.test(run) || !REAL.has(reached)) continue;
    fresh.push({row, sha, branch: text(item.branch, 80) || null, pr: Number.isInteger(item.pr) && item.pr > 0 ? item.pr : null,
      subjects: (Array.isArray(item.subjects) ? item.subjects : []).map(subject => text(subject, 120)).filter(Boolean).slice(0, 15),
      reached, applicant: text(item.applicant, 10) === 'grown' ? 'grown' : 'thin', run, at});
  }
  if (!fresh.length) return {ok: true, stored: 0};
  const runs = await readProven(db), known = new Set(runs.map(item => `${item.run}\n${item.row}`)), added = fresh.filter(item => !known.has(`${item.run}\n${item.row}`));
  if (!added.length) return {ok: true, stored: 0};
  const next = [...runs, ...added].sort((a, b) => a.at.localeCompare(b.at)).slice(-KEEP);
  await db.prepare('INSERT INTO applying_proven (key, at, body) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET at = excluded.at, body = excluded.body').bind('main', now.toISOString(), JSON.stringify(next)).run();
  return {ok: true, stored: added.length};
}

// A fix ({site, landedAt, subject}) -> the newest proof {at, run, by: 'main' | 'pr', pr?} or null ("not proven live").
export function provenFor(fix, records) {
  const landed = Date.parse(fix.landedAt);
  const proofs = records.filter(item => item.row === fix.site).flatMap(item => {
    if (item.branch === 'main' && Date.parse(item.at) >= landed) return [{at: item.at, run: item.run, by: 'main'}];
    if (item.pr && fix.subject && item.subjects.includes(fix.subject)) return [{at: item.at, run: item.run, by: 'pr', pr: item.pr}];
    return [];
  });
  return proofs.sort((a, b) => a.at.localeCompare(b.at)).at(-1) || null;
}

// PUT /applying/proven. A wrong or missing key is a 404, as the replays route (src/applying-replays.js).
export async function provenIngest(request, env, now = new Date()) {
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!(env.REPLAYS_PUBLISH_KEY && equal(given, env.REPLAYS_PUBLISH_KEY)) || !env.STATS) return new Response('Not found', {status: 404});
  const result = await storeProven(env.STATS, await request.json().catch(() => null), now);
  if (result.ok && result.stored) await dropSnapshot(env.STATS);   // the page's snapshot is recomputed on the next view
  return Response.json(result, {status: result.ok ? 200 : 400, headers: {'Cache-Control': 'no-store'}});
}
