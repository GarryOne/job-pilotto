// The product brain's log (table brain_messages, migrations/0030): every message the "Job Pilotto Brain" bot sends and every tap.
//   POST /api/brain/log (the scripts' key, `Authorization: Bearer`): tools/product_brain.py post|plan|status|backfill write here
//   record(db, ...): src/brain.js records each button tap
//   /admin/brain: the owner's page, latest first, filtered by a decision's status now (its newest row's)
// Notion ("🧭 Product Brain · Decisions") keeps its rows; this is the copy the page reads.
import {isOwner, esc, remember} from './stats.js';
import {viewer} from './auth.js';

export const KINDS = ['recommendation', 'plan', 'status', 'tap'];
export const STATUSES = ['Proposed', 'Exploring', 'Plan ready', 'Approved', 'Not now', 'Done'];
const cut = (value, size) => String(value ?? '').slice(0, size);
const decisionId = value => String(value || '').replace(/-/g, '').toLowerCase();

// One row; a repeat (same decision, kind, status and time: a re-run backfill) is ignored. Returns false for a row it refuses.
export async function record(db, message, now = new Date()) {
  const decision = decisionId(message.decision);
  if (!/^[0-9a-f]{32}$/.test(decision) || !KINDS.includes(message.kind)) return false;
  const status = STATUSES.includes(message.status) ? message.status : '';
  const at = message.at && !Number.isNaN(Date.parse(message.at)) ? new Date(message.at).toISOString() : now.toISOString();
  const telegram = Number.isInteger(message.telegram_id) ? message.telegram_id : null;
  const source = ['brain', 'tap', 'backfill'].includes(message.source) ? message.source : 'brain';
  // A backfill row (rebuilt from Notion, its time a guess) is skipped when the log already has that step of that decision.
  const known = source === 'backfill' && await db.prepare('SELECT 1 FROM brain_messages WHERE decision = ? AND kind = ? AND status = ? LIMIT 1')
    .bind(decision, message.kind, status).first();
  if (known) return true;
  await db.prepare(`INSERT OR IGNORE INTO brain_messages (decision, kind, title, body, status, notion_url, telegram_id, source, at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(decision, message.kind, cut(message.title, 300), cut(message.text, 20000), status,
    /^https:\/\/(www\.)?notion\.so\//.test(message.notion_url || '') ? cut(message.notion_url, 300) : '', telegram, source, at).run();
  return true;
}

// POST /api/brain/log: one message, or {messages: [...]} (the backfill). Answers how many were taken.
export async function log(request, env, now = new Date()) {
  if (request.method !== 'POST' || !await isOwner(request, env) || !env.STATS) return new Response('Not found', {status: 404});
  const body = await request.json().catch(() => null);
  const list = Array.isArray(body?.messages) ? body.messages.slice(0, 500) : body ? [body] : [];
  let saved = 0;
  for (const message of list) if (await record(env.STATS, message, now)) saved++;
  console.log(JSON.stringify({area: 'brain', event: 'log', got: list.length, saved}));
  return Response.json({saved, refused: list.length - saved}, {status: list.length && !saved ? 400 : 200});
}

// Every message newest first, each with its decision's title (the recommendation's) and status now.
export async function messages(db, limit = 500) {
  const rows = (await db.prepare('SELECT * FROM brain_messages ORDER BY at DESC, id DESC LIMIT ?').bind(limit).all()).results || [];
  const decisions = {};
  for (const row of [...rows].reverse()) {   // oldest first: the newest status wins
    const d = decisions[row.decision] ||= {title: '', status: '', notion_url: ''};
    if (row.kind === 'recommendation' && row.title) d.title = row.title;
    if (row.status) d.status = row.status;
    if (row.notion_url) d.notion_url = row.notion_url;
  }
  return rows.map(row => ({...row, decision_title: decisions[row.decision].title, now: decisions[row.decision].status,
    link: row.notion_url || decisions[row.decision].notion_url}));
}

const PILL = {Proposed: 'blue', Exploring: 'amber', 'Plan ready': 'violet', Approved: 'green', 'Not now': 'grey', Done: 'green'};
const KIND = {recommendation: '🧭 Recommendation', plan: '🗺️ Plan', status: '🔄 Status', tap: '👆 Tap'};
const pill = status => status ? `<span class="pill ${PILL[status] || 'grey'}">${esc(status)}</span>` : '';

export function page(rows, filter = '') {
  const counts = {};
  const seen = new Set();
  for (const row of rows) if (!seen.has(row.decision)) { seen.add(row.decision); counts[row.now || 'Unknown'] = (counts[row.now || 'Unknown'] || 0) + 1; }
  const shown = filter ? rows.filter(row => row.now === filter) : rows;
  const filters = [['', `All · ${seen.size}`], ...STATUSES.filter(s => counts[s]).map(s => [s, `${s} · ${counts[s]}`])].map(([value, label]) =>
    `<a class="filter${value === filter ? ' on' : ''}" href="/admin/brain${value ? `?status=${encodeURIComponent(value)}` : ''}">${esc(label)}</a>`).join('');
  const items = shown.map(row => {
    // The bold line is always the decision (its recommendation's title); a status change or a tap says its step beside the kind.
    const title = row.decision_title || row.title || '(untitled decision)';
    const step = row.kind === 'status' || row.kind === 'tap' ? ` → ${row.status ? pill(row.status) : '<span class="pill red">failed</span>'}` : '';
    return `<li class="msg"><div class="msg-head"><span class="muted when">${esc(row.at.slice(0, 16).replace('T', ' '))}</span>
<span class="kind">${KIND[row.kind] || esc(row.kind)}${step}</span><b class="title">${esc(title)}</b>
<span class="right">${pill(row.now)}${row.link ? ` <a href="${esc(row.link)}" target="_blank" rel="noopener">Notion ↗</a>` : ''}</span></div>
${row.body ? `<details><summary>Full text</summary><div class="body">${esc(row.body)}</div></details>` : ''}</li>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Product Brain · Admin</title><link rel="icon" href="/favicon-32.png">
<style>
:root{--bg:#0b0d10;--card:#14181d;--line:#262c33;--text:#f4efe3;--muted:#8d949c;--amber:#f5b54a}
*{box-sizing:border-box}h2{margin:0 0 8px}.card{padding:16px;margin-bottom:12px;display:block}
.filters{display:flex;gap:6px;flex-wrap:wrap}.filter{color:var(--muted);text-decoration:none;padding:5px 10px;border:1px solid var(--line);border-radius:999px;font-size:13px}
.filter:hover{color:var(--text)}.filter.on{background:var(--amber);color:var(--bg);border-color:var(--amber);font-weight:600}
.msgs{list-style:none;margin:0;padding:0}.msg{padding:10px 0;border-top:1px solid var(--line)}.msg:first-child{border-top:0}
.msg-head{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}.when{font-size:12px;font-variant-numeric:tabular-nums}.kind{font-size:12px;color:var(--muted)}
.title{font-weight:600}.right{margin-left:auto;display:flex;gap:8px;align-items:baseline;font-size:13px}
.pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}
.pill.blue{background:#1d3a5c;color:#9cc7f5}.pill.amber{background:#4a3a14;color:#f5b54a}.pill.violet{background:#3a2a5c;color:#c5a8f5}
.pill.green{background:#163f2e;color:#6fd3a4}.pill.red{background:#4a1d1f;color:#f08a8d}.pill.grey{background:#262c33;color:#8d949c}
details{margin-top:6px}summary{cursor:pointer;color:var(--muted);font-size:13px}.body{white-space:pre-wrap;margin-top:6px;padding:10px 12px;background:var(--bg);border-radius:10px;font-size:14px}
</style></head><body><main>
<header><h1>🧠 Product Brain</h1><span class="muted">every message of the Brain bot and every tap · newest first · Notion keeps the decisions</span></header>
<section class="card"><h2>Status now</h2><nav class="filters" aria-label="Filter by status">${filters}</nav></section>
<section class="card"><h2>Messages${filter ? ` · decisions now ${esc(filter)}` : ''}</h2>${items
  ? `<ul class="msgs">${items}</ul>` : `<p class="muted">${filter ? 'No decision has this status now.' : 'No brain message logged yet.'}</p>`}</section>
</main></body></html>`;
}

export async function view(request, env) {
  if (!await viewer(request, env)) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  if (url.searchParams.has('key')) return remember(url, env, request);
  if (!env.STATS) return new Response('No database', {status: 503});
  const filter = STATUSES.includes(url.searchParams.get('status')) ? url.searchParams.get('status') : '';
  return new Response(page(await messages(env.STATS), filter), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'}});
}
