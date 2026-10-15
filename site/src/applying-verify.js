// /admin/lab-form-filling's "Confirmed offline" (owner, 14 Oct 2026): the verdict of an offline replay of a pool row's recording, for a landed fix ("Confirmed offline" / "Not better offline" /
// "Needs a recording") and for a row that got less far than before ("Our build" / "Site changed" / "Needs a recording"). It is the page's only proof of a fix (owner, 14 Oct 2026: no live run proves a fix); the replay shows what the build does on a page that no longer changes. CI (.github/workflows/fix-verdicts.yml) sends the verdicts of a run:
// PUT /applying/verify, Bearer REPLAYS_PUBLISH_KEY, stored as ONE row, a row's newest verdict replacing its old one by (kind, name). Guard: test/applying-verify.test.js.
import {dropSnapshot} from './applying-store.js';
import {equal} from './guard.js';

const KEEP = 300;
const KINDS = ['fixed', 'regression'], VERDICTS = {fixed: ['confirmed', 'holds', 'notbetter', 'live'], regression: ['ours', 'site', 'live']};
const HASH = /^[0-9a-f]{7,40}$/;
const text = (value, max) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const nameOf = value => { const name = text(value, 120); return name && !/[?=@]|:\/\/|https?:/i.test(name) ? name : null; };
const isoOf = value => { const time = Date.parse(text(value, 40)); return Number.isFinite(time) ? new Date(time).toISOString() : null; };
const WORDS = /^[a-z0-9]/i;

export async function readVerify(db) {
  const row = await db.prepare("SELECT body FROM applying_verify WHERE key = 'main'").bind().first().catch(() => null);
  try { return row ? JSON.parse(row.body) : []; } catch { return []; }
}

// {sha, rows: [{kind, row, verdict, why, commit?, buildBy?, recordedAt?, olderAt?}]} -> {ok, stored}. An identical verdict writes nothing (the same run sent again).
export async function storeVerify(db, body, now = new Date()) {
  const sha = text(body?.sha, 40).toLowerCase(), incoming = Array.isArray(body?.rows) ? body.rows.slice(0, 200) : [];
  if (!HASH.test(sha) || !incoming.length) return {ok: false, error: 'sha and rows are required'};
  const fresh = [];
  for (const item of incoming) {
    const kind = text(item?.kind, 12), row = nameOf(item?.row), verdict = text(item?.verdict, 12);
    if (!KINDS.includes(kind) || !row || !VERDICTS[kind].includes(verdict)) continue;
    const why = text(item.why, 160), commit = text(item.commit, 40).toLowerCase();
    fresh.push({kind, row, verdict, why: WORDS.test(why) && !/[?=@]|:\/\/|https?:/i.test(why) ? why : '', commit: HASH.test(commit) ? commit : null, buildBy: ['version', 'time'].includes(item.buildBy) ? item.buildBy : null,
      recordedAt: isoOf(item.recordedAt), olderAt: isoOf(item.olderAt), at: now.toISOString(), sha});
  }
  if (!fresh.length) return {ok: true, stored: 0};
  const old = await readVerify(db), key = item => `${item.kind}\n${item.row}`, mine = new Map(fresh.map(item => [key(item), item]));
  const same = item => { const was = old.find(one => key(one) === key(item)); return was && ['verdict', 'why', 'commit', 'buildBy', 'recordedAt', 'olderAt'].every(field => was[field] === item[field]); };
  const changed = fresh.filter(item => !same(item));
  if (!changed.length) return {ok: true, stored: 0};
  const next = [...old.filter(item => !mine.has(key(item))), ...fresh.map(item => (same(item) ? old.find(one => key(one) === key(item)) : item))].sort((a, b) => a.at.localeCompare(b.at)).slice(-KEEP);
  await db.prepare('INSERT INTO applying_verify (key, at, body) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET at = excluded.at, body = excluded.body').bind('main', now.toISOString(), JSON.stringify(next)).run();
  return {ok: true, stored: changed.length};
}

// A row's newest verdict of a kind -> {verdict, why, at, ...} or null (nothing replayed for it yet).
export const verifyFor = (records, kind, row) => records.filter(item => item.kind === kind && item.row === row).at(-1) || null;

// PUT /applying/verify. A wrong or missing key is a 404, as the replays and proven routes.
export async function verifyIngest(request, env, now = new Date()) {
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!(env.REPLAYS_PUBLISH_KEY && equal(given, env.REPLAYS_PUBLISH_KEY)) || !env.STATS) return new Response('Not found', {status: 404});
  const result = await storeVerify(env.STATS, await request.json().catch(() => null), now);
  if (result.ok && result.stored) await dropSnapshot(env.STATS);   // the page's snapshot is recomputed on the next view
  return Response.json(result, {status: result.ok ? 200 : 400, headers: {'Cache-Control': 'no-store'}});
}
