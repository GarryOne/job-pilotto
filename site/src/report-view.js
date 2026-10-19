// The owner's page /admin/reports ("Reported forms"): every "Report this form" the installs sent, newest first, counts only (the recording is encrypted; the Worker has no host or page).
// Status: waiting (not yet fetched), fetched (the owner's Mac took it), expired (older than 30 days: the bucket's lifecycle rule has removed the recording). Also the day's totals against the caps.
// Guarded by test/report-view.test.js.
import {esc} from './stats.js';
import {viewer} from './auth.js';
import {causeWords} from './report-notify.js';
import {ALL_BYTES_PER_DAY, ALL_REPORTS_PER_DAY, KEEP_DAYS, PER_INSTALL_PER_DAY} from './report-form.js';

const mb = bytes => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`);
const dayAgo = (now, days) => new Date(now.getTime() - days * 86400e3).toISOString().slice(0, 10);

export const statusOf = (row, now) => (row.day < dayAgo(now, KEEP_DAYS) ? 'expired' : row.status === 'new' ? 'waiting' : row.status);

export function page({rows, today, now = new Date()}) {
  const body = rows.map(row => {
    const status = statusOf(row, now);
    return `<tr><td>${esc(row.day)}</td><td><code>${esc(String(row.who).slice(0, 8))}</code></td><td class="num">${Number(row.requests) || 0}</td><td>${esc(causeWords(row.cause))}</td>
    <td><span class="st ${status}">${status}</span></td><td class="num">${mb(Number(row.bytes) || 0)}</td></tr>`;
  }).join('');
  const waiting = rows.filter(row => statusOf(row, now) === 'waiting').length;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Reported forms · Admin</title><link rel="icon" href="/favicon-32.png">
<style>.rep .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:16px}.rep .tile b{display:block;font-size:32px;margin-top:4px}
.rep .st{font-size:12px;font-weight:700;padding:2px 8px;border-radius:99px;background:#262c33}.rep .st.waiting{color:#f5b54a}.rep .st.fetched{color:#5ec4b6}.rep .st.expired{color:#8d949c}</style></head>
<body><main class="rep"><header><h1>📮 Reported forms</h1><span class="muted">${waiting} waiting · ${rows.length} in the last ${KEEP_DAYS} days</span></header>
<div class="tiles"><div class="card tile"><span class="muted">Reports today</span><b>${Number(today?.reports) || 0} / ${ALL_REPORTS_PER_DAY}</b><small class="muted">across all installs; ${PER_INSTALL_PER_DAY} per install a day</small></div>
<div class="card tile"><span class="muted">Size today</span><b>${mb(Number(today?.bytes) || 0)}</b><small class="muted">cap ${mb(ALL_BYTES_PER_DAY)} a day</small></div></div>
<section class="card"><h2>Newest first</h2><table><tr><th>Date</th><th>Install</th><th>Responses</th><th>Cause</th><th>Status</th><th>Size</th></tr>
${body || '<tr><td colspan="6" class="muted">No report yet.</td></tr>'}</table>
<small class="muted" style="display:block;margin-top:8px">Counts only: the recording is encrypted on the install and only your Mac's key opens it. To open the waiting ones on the Mac: <code>node desktop/e2e/reports-fetch.mjs &lt;records dir&gt;</code> (decrypts, writes pool records, marks them fetched). A recording is removed after ${KEEP_DAYS} days.</small></section>
</main></body></html>`;
}

export async function view(request, env, now = new Date()) {
  if (!await viewer(request, env)) return new Response('Not found', {status: 404});
  const day = now.toISOString().slice(0, 10);
  const run = async (sql, ...binds) => { try { return (await env.STATS.prepare(sql).bind(...binds).all()).results || []; } catch { return []; } };
  const rows = env.STATS ? await run('SELECT id, day, who, bytes, requests, cause, status FROM form_reports ORDER BY day DESC, rowid DESC LIMIT 200') : [];
  const today = env.STATS ? (await run('SELECT reports, bytes FROM form_report_days WHERE day = ?', day))[0] : null;
  return new Response(page({rows, today, now}), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'}});
}
