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
    /^https:\/\/([a-z0-9-]+\.)*notion\.(so|site|com)\//.test(message.notion_url || '') ? cut(message.notion_url, 300) : '', telegram, source, at).run();
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
    link: row.notion_url || decisions[row.decision].notion_url || `https://www.notion.so/${row.decision}`}));
}

const PILL = {Proposed: 'blue', Exploring: 'amber', 'Plan ready': 'violet', Approved: 'green', 'Not now': 'grey', Done: 'green'};
const STEP = {recommendation: '🧭 Recommended', plan: '🗺️ Plan', status: '🔄 Status', tap: '👆 Tapped'};
const pill = status => status ? `<span class="pill ${PILL[status] || 'grey'}">${esc(status)}</span>` : '';
const when = at => esc(String(at).slice(0, 16).replace('T', ' '));
// A text in a toggle: its first non-empty line is the preview, the click opens the rest.
function toggle(text, className = 'text') {
  const lines = String(text || '').split('\n').filter(line => line.trim());
  if (!lines.length) return '';
  if (lines.length === 1 && lines[0].length <= 160) return `<p class="${className}">${esc(lines[0])}</p>`;
  return `<details class="${className}"><summary>${esc(lines[0].slice(0, 160))}</summary><div class="full">${esc(text).replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')}</div></details>`;
}

// One card per decision, the latest activity first: its recommendation (title, lens, the full text in a toggle) and every later
// step (plan, tap, status change) as a line with its own text. Rows come newest first (messages()).
export function decisions(rows) {
  const byId = new Map();
  for (const row of rows) {
    const d = byId.get(row.decision) || {id: row.decision, title: row.decision_title || row.title, now: row.now, link: row.link, last: row.at, steps: []};
    if (row.kind === 'recommendation') d.recommendation = row; else d.steps.unshift(row);   // steps oldest first
    byId.set(row.decision, d);
  }
  return [...byId.values()];
}

export function page(rows, filter = '') {
  const all = decisions(rows), counts = {};
  for (const d of all) counts[d.now || 'Unknown'] = (counts[d.now || 'Unknown'] || 0) + 1;
  const shown = filter ? all.filter(d => d.now === filter) : all;
  const filters = [['', `All · ${all.length}`], ...STATUSES.filter(s => counts[s]).map(s => [s, `${s} · ${counts[s]}`])].map(([value, label]) =>
    `<a class="filter${value === filter ? ' on' : ''}" href="/admin/brain${value ? `?status=${encodeURIComponent(value)}` : ''}">${esc(label)}</a>`).join('');
  const cards = shown.map(d => {
    const rec = d.recommendation, lens = /^Lens: (.+)$/m.exec(rec?.body || '')?.[1];
    const body = (rec?.body || '').replace(/^Lens: .+\n?/m, '');
    const steps = d.steps.map(step => `<li><span class="muted">${when(step.at)}</span> ${STEP[step.kind] || esc(step.kind)}${step.kind === 'plan' ? ''
      : ` → ${step.status ? pill(step.status) : '<span class="pill red">failed</span>'}`}${toggle(step.kind === 'plan' ? step.body || step.title : step.body, 'step-text')}</li>`).join('');
    return `<article class="card decision">
<div class="meta"><span>${when(rec?.at || d.steps[0]?.at || d.last)}</span>${lens ? `<span>${esc(lens)}</span>` : ''}<span class="right">${pill(d.now)}
<a href="${esc(d.link)}" target="_blank" rel="noopener">Notion ↗</a></span></div>
<h3>${esc(d.title || '(untitled decision)')}</h3>${toggle(body)}
${steps ? `<ul class="steps">${steps}</ul>` : ''}</article>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Product Brain · Admin</title><link rel="icon" href="/favicon-32.png">
<style>
:root{--bg:#0b0d10;--card:#14181d;--line:#262c33;--text:#f4efe3;--muted:#8d949c;--amber:#f5b54a}
*{box-sizing:border-box}.card{padding:14px 16px;margin-bottom:10px;display:block}
.filters{margin-bottom:14px}
.meta{font-size:12px;color:var(--muted);display:flex;gap:10px;align-items:center;flex-wrap:wrap}.meta .right{margin-left:auto;display:flex;gap:10px;align-items:center}
.decision h3{margin:6px 0 4px;font-size:16px;line-height:1.35}
.text,.step-text{margin:0;color:var(--muted);font-size:14px;overflow-wrap:anywhere}.step-text{display:block;margin:2px 0 0 0}
details summary{cursor:pointer;list-style:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}details summary::-webkit-details-marker{display:none}
details summary::before{content:'▸ ';color:var(--amber)}details[open] summary{font-size:0}details[open] summary::before{content:'▾ Less';font-size:13px}
.full{white-space:pre-wrap;color:var(--text);margin-top:6px;padding:10px 12px;background:var(--bg);border-radius:10px}
.steps{list-style:none;margin:10px 0 0;padding:8px 0 0;border-top:1px solid var(--line);font-size:13px}.steps li{margin:4px 0}
.pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}
.pill.blue{background:#1d3a5c;color:#9cc7f5}.pill.amber{background:#4a3a14;color:#f5b54a}.pill.violet{background:#3a2a5c;color:#c5a8f5}
.pill.green{background:#163f2e;color:#6fd3a4}.pill.grey{background:#262c33;color:#8d949c}.pill.red{background:#4a1d1f;color:#f08a8d}
</style></head><body><main>
<header><h1>🧠 Product Brain</h1><span class="muted">one card per decision · latest activity first · Notion keeps the decisions</span></header>
<nav class="filters" aria-label="Filter by status">${filters}</nav>
${cards || `<p class="muted">${filter ? 'No decision has this status now.' : 'No brain message logged yet.'}</p>`}
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
