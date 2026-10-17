// /admin/operations/build-log: the daily build digest, a day-by-day history (spec docs/superpowers/specs/2026-10-16-daily-digest.md). tools/daily-digest.mjs (daily-digest.yml, hourly) writes it:
// GET /digest/data?day= says what is stored for a day (so CI skips an unchanged set), PUT /digest/data stores a draft or the final one (Bearer SELFHEAL_PUBLISH_KEY). One row per day (digest_days); a closed day ignores later drafts.
// The page draws the groups itself (never markdown parsed from a string). No AI here. Guard: test/build-log.test.js.
import {viewer} from './auth.js';
import {equal} from './guard.js';
import {esc, remember} from './stats.js';
import {canClose, countOf, dayWords, isClosed, prList} from './build-digest.js';

const SHOWN = 45, MAX_DRAFTS = 8;
const authorized = (request, env) => Boolean(env.SELFHEAL_PUBLISH_KEY && equal((request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''), env.SELFHEAL_PUBLISH_KEY));
const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
const isDay = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const text = (value, max) => String(value ?? '').slice(0, max);

// Groups from CI -> the same shape with every string cut, or null when it is not one.
export function cleanGroups(groups) {
  if (!Array.isArray(groups) || groups.length > 12) return null;
  const out = groups.map(group => ({emoji: text(group?.emoji, 8), title: text(group?.title, 80), bullets: (Array.isArray(group?.bullets) ? group.bullets : []).slice(0, 8).map(bullet => ({lead: text(bullet?.lead, 80), text: text(bullet?.text, 260), prs: (Array.isArray(bullet?.prs) ? bullet.prs : []).map(Number).filter(Number.isInteger).slice(0, 200)}))}));
  return out.every(group => group.emoji && group.title && group.bullets.every(bullet => bullet.lead && bullet.text)) ? out : null;
}

export async function ingest(request, env, now = new Date()) {
  if (!authorized(request, env)) return new Response('Not found', {status: 404});
  const day = new URL(request.url).searchParams.get('day');
  if (request.method === 'GET') {
    if (!isDay(day)) return json({error: 'day'}, 400);
    const row = await env.STATS.prepare('SELECT numbers, drafts, updated_at AS updatedAt, final_at AS finalAt FROM digest_days WHERE day = ?').bind(day).first();
    return json(row ? {numbers: JSON.parse(row.numbers), drafts: row.drafts, updatedAt: row.updatedAt, finalAt: isClosed(day, row.finalAt) ? row.finalAt : null, maxDrafts: MAX_DRAFTS} : {numbers: null, drafts: 0, maxDrafts: MAX_DRAFTS});
  }
  const body = await request.text();
  if (body.length > 200000) return new Response('Too large', {status: 413});
  let data;
  try { data = JSON.parse(body); } catch { return new Response('Not JSON', {status: 400}); }
  const groups = cleanGroups(data?.groups), numbers = Array.isArray(data?.numbers) ? data.numbers.map(Number).filter(Number.isInteger) : null;
  if (!isDay(data?.day) || !groups || !numbers || numbers.length > 1000) return new Response('Unexpected shape', {status: 400});
  const at = now.toISOString(), usd = Number(data.usd) || 0;
  const existing = await env.STATS.prepare('SELECT final_at AS finalAt FROM digest_days WHERE day = ?').bind(data.day).first();
  // A closed day ignores later drafts; only an explicit rewrite (a re-run of an old day in the new form, by hand) replaces it, and the day stays closed.
  const closed = isClosed(data.day, existing?.finalAt);
  if (closed && data.rewrite !== true) return json({ok: true, ignored: 'day is closed'});
  // A final before 23:00 Zurich of its day is stored as a draft (canClose); a final stored earlier by mistake counts as a draft too (isClosed).
  const final = closed ? existing.finalAt : (data.final === true && canClose(data.day, now) ? at : null);
  await env.STATS.prepare(`INSERT INTO digest_days (day, groups, open_line, numbers, drafts, usd, updated_at, final_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(day) DO UPDATE SET groups = excluded.groups, open_line = excluded.open_line, numbers = excluded.numbers, drafts = digest_days.drafts + 1, usd = digest_days.usd + excluded.usd, updated_at = excluded.updated_at, final_at = excluded.final_at`)
    .bind(data.day, JSON.stringify(groups), text(data.open, 260), JSON.stringify(numbers), usd, at, final).run();
  return json({ok: true, final: Boolean(final), rewritten: closed});
}

// ---- the page ----
const usdText = value => `$${(Number(value) || 0).toFixed(3)}`;
// A long line is cut at a word and its full text folds behind the line (older digests wrote up to 220 characters; new ones write about 90).
export const LINE = 90;
export const cut = value => { const full = String(value); if (full.length <= LINE) return full; const head = full.slice(0, LINE + 1).replace(/\s+\S*$/, ''); return `${head || full.slice(0, LINE)}…`; };
const prCount = group => { const n = new Set(group.bullets.flatMap(bullet => bullet.prs)).size; return `${n} PR${n === 1 ? '' : 's'}`; };
function itemRow(bullet, link) {
  const chips = bullet.prs.map(number => `<span class="chip">${link(number)}</span>`).join('');
  const line = cut(bullet.text), more = line !== bullet.text;
  const head = `<b>${esc(bullet.lead)}</b> <span class="muted">${esc(line)}</span>`;
  return `<li>${more ? `<details><summary>${head}</summary><p class="muted">${esc(bullet.text)}</p></details>` : head} ${chips}</li>`;
}
function dayCard(row, {open = false, repo}) {
  const groups = JSON.parse(row.groups), numbers = JSON.parse(row.numbers), {count, min, max} = countOf(numbers);
  const link = number => `<a href="https://github.com/${esc(repo)}/pull/${number}">#${number}</a>`;
  const state = isClosed(row.day, row.final_at) ? `<span class="pill" style="background:#7bd88f">Final</span>` : `<span class="pill" style="background:#f2c14e">Draft ${row.drafts}</span>`;
  const goals = groups.map(group => `<section class="card goal"><h2>${esc(group.emoji)} ${esc(group.title)} <span class="muted">${prCount(group)}</span></h2><ul>${group.bullets.map(bullet => itemRow(bullet, link)).join('')}</ul></section>`).join('');
  return `<details class="day"${open ? ' open' : ''}><summary><b>${esc(dayWords(row.day))}</b> ${state} <span class="muted">${count} PRs${count ? `, #${min}-#${max}` : ''} · ${groups.length} goals · updated ${esc(String(row.updated_at).slice(11, 16))} UTC · ${usdText(row.usd)}</span></summary><div class="goals">${goals}</div><p><b>Still open:</b> ${esc(row.open_line || 'Nothing open.')}</p></details>`;
}

export function page(rows, {repo = 'GarryOne/job-pilotto', day = ''} = {}) {
  const list = day ? rows.filter(row => row.day === day) : rows;
  const body = list.length ? list.map((row, i) => dayCard(row, {open: i === 0, repo})).join('') : `<section class="card"><h2>No digest yet</h2><p class="muted">The workflow <code>daily-digest.yml</code> writes the day's digest every hour when a PR was merged; the first run fills this page.</p></section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Build log · Operations · Admin</title>
<link rel="icon" href="/favicon-32.png"><style>.day{margin-bottom:22px}.day>summary,.goal summary{cursor:pointer;list-style:none}.day>summary{padding:6px 0 12px}.day>summary b{font-size:17px}
.goals{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:12px;margin-bottom:12px}.goal{margin:0}.goal h2{margin:0 0 8px}.goal ul{margin:0;padding:0;list-style:none}
.goal li{padding:7px 0;border-top:1px solid #262c33}.goal li:first-child{border-top:0}.goal details p{margin:4px 0 0;font-size:14px}.goal li>b{font-weight:600}
.chip{display:inline-block;padding:0 6px;border-radius:6px;background:#1b2027;font-size:12px;white-space:nowrap}
.pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600;color:#0b0d10}</style></head><body><main>
<header><h1>🗓️ Build log</h1><span class="muted">what we built each day, grouped by goal · the newest ${SHOWN} days</span></header>
${body}</main></body></html>`;
}

export async function view(request, env) {
  if (!await viewer(request, env)) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  if (url.searchParams.has('key')) return remember(url, env, request);
  let rows = [];
  try { rows = env.STATS ? (await env.STATS.prepare('SELECT day, groups, open_line, numbers, drafts, usd, updated_at, final_at FROM digest_days ORDER BY day DESC LIMIT ?').bind(SHOWN).all()).results || [] : []; } catch { rows = []; }
  const day = url.searchParams.get('day');
  return new Response(page(rows, {repo: env.GITHUB_REPO || undefined, day: isDay(day) ? day : ''}), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});
}
