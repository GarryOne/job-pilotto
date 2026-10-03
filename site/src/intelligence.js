// What the installs teach about the job search itself (Notion: "Knowledge as data: build plan"). Counts only, by coarse fixed-list tags: no job
// title, no company, no text, no install. Four signals, all on the Technical reports switch:
//   1 role words people accept from the "your search may be too narrow" card, by role and region (a fixed vocabulary; a word is shown by name
//     only once 3+ people chose it)
//   2 how much of the market the role keywords catch, and which fixed role words they miss
//   3 why a job was dismissed (a one-tap reason), by the job's fit-score band
//   4 a daily snapshot of score band vs what became of the job (new, saved, applied, replied ...): does the score predict action?
// store() takes the `intel` part of POST /api/controls; view() is the owner's /intel page (/intelligence is the public one).
import {report as aiCost} from './aicost.js';
import {REGIONS, ROLES} from './pool.js';
import {cleanLabel} from '../../extension/alias-schema.js';
import {digestOf} from './guard.js';
import {LEFT_REASONS} from './knowledge.js';
import {allowed} from './stats.js';

export const REASONS = ['seniority', 'location', 'tech', 'company', 'role', 'other'];
export const BUCKETS = ['0-39', '40-59', '60-79', '80-100', 'unscored'];
export const STATES = ['new', 'saved', 'dismissed', 'applying', 'applied', 'screening', 'interviewing', 'offer', 'rejected', 'no_response', 'withdrawn'];
export const MIN_PEOPLE = 3;
export const OUTCOMES = ['reply', 'screening', 'offer', 'rejected', 'no_response'];
const GOOD = ['reply', 'screening', 'offer'];
const BOARD_KIND = /^[a-z]{3,20}$/;
const TERM = /^[a-z][a-z0-9+#.\- ]{1,38}[a-z0-9+#]$/;
const REASON_TEXT = {no_answer: 'No answer in the profile', not_taken: 'Answer given, field did not take it', real_click: 'Dropdown needs a real click', no_option: 'Dropdown opened, no option matched', other: 'Other'};
const day = date => date.toISOString().slice(0, 10);
const pct = value => (value == null ? '–' : `${Math.round(value * 100)}%`);
const int = (value, max) => Math.max(0, Math.min(max, Math.round(Number(value)) || 0));
const pick = (value, list, fallback) => (list.includes(value) ? value : fallback);

// -> counts stored, for the response and the tests.
export async function store(env, intel, now = new Date(), install = '') {
  const out = {terms: 0, coverage: 0, dismissals: 0, snapshot: 0, replies: 0, sources: 0, fixes: 0};
  if (!env.STATS || !intel || typeof intel !== 'object') return out;
  const d = day(now);
  const tags = item => [pick(item?.role, ROLES, 'other'), pick(item?.region, REGIONS, 'none')];
  for (const item of (Array.isArray(intel.terms) ? intel.terms : []).slice(0, 5)) {
    const term = String(item?.term || '').toLowerCase().trim();
    if (!TERM.test(term)) continue;
    const [role, region] = tags(item);
    await env.STATS.prepare('INSERT INTO intel_terms (day, term, role, region, n) VALUES (?, ?, ?, ?, 1) ON CONFLICT (day, term, role, region) DO UPDATE SET n = n + 1').bind(d, term, role, region).run();
    out.terms++;
  }
  const c = intel.coverage;
  if (c && typeof c === 'object') {
    const inPlaces = int(c.in_places, 1e6), matched = Math.min(int(c.matched, 1e6), inPlaces);
    const [role, region] = tags(c);
    if (inPlaces > 0) {
      await env.STATS.prepare(`INSERT INTO intel_coverage (day, role, region, reports, in_places, matched) VALUES (?, ?, ?, 1, ?, ?)
        ON CONFLICT (day, role, region) DO UPDATE SET reports = reports + 1, in_places = in_places + excluded.in_places, matched = matched + excluded.matched`).bind(d, role, region, inPlaces, matched).run();
      for (const miss of (Array.isArray(c.missed) ? c.missed : []).slice(0, 21)) {
        const term = String(miss?.term || '').toLowerCase().trim(), count = int(miss?.count, 1e6);
        if (!TERM.test(term) || !count) continue;
        await env.STATS.prepare(`INSERT INTO intel_missed (day, role, region, term, count, reports) VALUES (?, ?, ?, ?, ?, 1)
          ON CONFLICT (day, role, region, term) DO UPDATE SET count = count + excluded.count, reports = reports + 1`).bind(d, role, region, term, count).run();
      }
      out.coverage = 1;
    }
  }
  for (const item of (Array.isArray(intel.dismissals) ? intel.dismissals : []).slice(0, 20)) {
    const reason = String(item?.reason || ''), bucket = String(item?.bucket || ''), n = int(item?.n, 50);
    if (!REASONS.includes(reason) || !BUCKETS.includes(bucket) || !n) continue;
    await env.STATS.prepare('INSERT INTO intel_dismiss (day, reason, bucket, n) VALUES (?, ?, ?, ?) ON CONFLICT (day, reason, bucket) DO UPDATE SET n = n + excluded.n').bind(d, reason, bucket, n).run();
    out.dismissals++;
  }
  for (const item of (Array.isArray(intel.snapshot) ? intel.snapshot : []).slice(0, 60)) {
    const bucket = String(item?.bucket || ''), state = String(item?.state || ''), n = int(item?.n, 5000);
    if (!BUCKETS.includes(bucket) || !STATES.includes(state) || !n) continue;
    await env.STATS.prepare('INSERT INTO intel_scores (day, bucket, state, n) VALUES (?, ?, ?, ?) ON CONFLICT (day, bucket, state) DO UPDATE SET n = n + excluded.n').bind(d, bucket, state, n).run();
    out.snapshot++;
  }
  for (const item of (Array.isArray(intel.replies) ? intel.replies : []).slice(0, 25)) {
    const bucket = String(item?.bucket || ''), outcome = String(item?.outcome || ''), n = int(item?.n, 100);
    if (!BUCKETS.includes(bucket) || !OUTCOMES.includes(outcome) || !n) continue;
    await env.STATS.prepare('INSERT INTO intel_replies (day, bucket, outcome, n) VALUES (?, ?, ?, ?) ON CONFLICT (day, bucket, outcome) DO UPDATE SET n = n + excluded.n').bind(d, bucket, outcome, n).run();
    out.replies++;
  }
  for (const item of (Array.isArray(intel.sources) ? intel.sources : []).slice(0, 12)) {
    const board = String(item?.board || '');
    const [seen, acted, dismissed, heard] = ['seen', 'acted', 'dismissed', 'heard'].map(field => int(item?.[field], 5000));
    if (!BOARD_KIND.test(board) || !seen) continue;
    await env.STATS.prepare(`INSERT INTO intel_sources (day, board, seen, acted, dismissed, heard) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (day, board) DO UPDATE SET seen = seen + excluded.seen, acted = acted + excluded.acted, dismissed = dismissed + excluded.dismissed, heard = heard + excluded.heard`)
      .bind(d, board, seen, Math.min(acted, seen), Math.min(dismissed, seen), Math.min(heard, seen)).run();
    out.sources++;
  }
  const who = (await digestOf(String(install || 'anonymous'))).slice(0, 8);
  for (const item of (Array.isArray(intel.fixes) ? intel.fixes : []).slice(0, 40)) {
    const label = cleanLabel(item?.label), filled = int(item?.filled, 100), corrected = Math.min(int(item?.corrected, 100), Math.max(filled, 1));
    if (!label || (!filled && !corrected)) continue;
    const row = await env.STATS.prepare('SELECT installs FROM intel_fixes WHERE label = ?').bind(label).first();
    let installs = [];
    try { installs = JSON.parse(row?.installs || '[]'); } catch { /* start again */ }
    if (!installs.includes(who)) installs = [...installs, who].slice(-5);
    await env.STATS.prepare(`INSERT INTO intel_fixes (label, filled, corrected, installs, last_day) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (label) DO UPDATE SET filled = filled + excluded.filled, corrected = corrected + excluded.corrected, installs = excluded.installs, last_day = excluded.last_day`)
      .bind(label, filled, corrected, JSON.stringify(installs), d).run();
    out.fixes++;
  }
  return out;
}

// Daily: a question wording only one or two installs ever reported is not kept (the same rule as question_labels).
export async function tidy(db, now = new Date()) {
  const cutoff = day(new Date(now.getTime() - 14 * 86400000));
  let dropped = 0;
  for (const row of await rows(db, 'SELECT label, installs FROM intel_fixes WHERE last_day < ?', cutoff)) {
    let count = 0;
    try { count = JSON.parse(row.installs).length; } catch { /* unreadable: drop */ }
    if (count < MIN_PEOPLE) { await db.prepare('DELETE FROM intel_fixes WHERE label = ?').bind(row.label).run(); dropped++; }
  }
  return {dropped};
}

const rows = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all().catch(() => ({results: []}))).results || [];

// Scoring hints for the apps (GET /api/packs/aliases carries them): the reasons people most often give for dismissing a job, as {reason, share}.
// Only the fixed reason word leaves; the app turns it into a sentence from its own templates, so the server can never put text in a prompt.
// Needs 50+ dismissals in the last 30 days, and a reason must be 30%+ of them. "other" is not a hint.
export const HINT_MIN = 50, HINT_SHARE = 0.3;
export async function hints(db, now = new Date()) {
  const from = day(new Date(now.getTime() - 29 * 86400000));
  const found = await rows(db, 'SELECT reason, SUM(n) AS n FROM intel_dismiss WHERE day >= ? GROUP BY reason', from);
  const total = found.reduce((sum, row) => sum + row.n, 0);
  if (total < HINT_MIN) return [];
  return found.filter(row => row.reason !== 'other' && REASONS.includes(row.reason) && row.n / total >= HINT_SHARE)
    .sort((a, b) => b.n - a.n).slice(0, 3).map(row => ({reason: row.reason, share: Math.round(row.n / total * 100) / 100}));
}

// Does the score predict replies? Compares the reply rate of the top band with the next one (each needs 20+ marked outcomes).
export function calibration(replies) {
  const top = replies.find(row => row.bucket === '80-100'), next = replies.find(row => row.bucket === '60-79'), low = replies.find(row => row.bucket === '40-59');
  if (top?.rate == null) return {status: 'thin', note: 'Not enough marked outcomes in the 80+ band yet.'};
  const lower = next?.rate != null ? next : low?.rate != null ? low : null;
  if (!lower) return {status: 'thin', note: 'Not enough marked outcomes in a lower band to compare.'};
  if (top.rate < lower.rate) return {status: 'inverted', note: `Jobs scored 80+ get fewer replies (${pct(top.rate)}) than ${lower.bucket} (${pct(lower.rate)}): the scoring rubric needs a look.`};
  if (top.rate - lower.rate < 0.05) return {status: 'flat', note: `80+ (${pct(top.rate)}) is barely better than ${lower.bucket} (${pct(lower.rate)}): the score is not predicting replies.`};
  return {status: 'ok', note: `80+ gets ${pct(top.rate)} replies against ${pct(lower.rate)} for ${lower.bucket}: the score predicts replies.`};
}

export async function report(db, days = 30, now = new Date()) {
  const from = day(new Date(now.getTime() - (days - 1) * 86400000));
  const terms = await rows(db, 'SELECT term, SUM(n) AS n FROM intel_terms WHERE day >= ? GROUP BY term ORDER BY n DESC', from);
  const shown = terms.filter(row => row.n >= MIN_PEOPLE);
  const where = {};
  for (const row of await rows(db, 'SELECT term, role, region, SUM(n) AS n FROM intel_terms WHERE day >= ? GROUP BY term, role, region ORDER BY n DESC', from)) {
    if (shown.some(item => item.term === row.term)) (where[row.term] ||= []).push(`${row.role}/${row.region} ×${row.n}`);
  }
  const coverage = (await rows(db, 'SELECT role, region, SUM(reports) AS reports, SUM(in_places) AS in_places, SUM(matched) AS matched FROM intel_coverage WHERE day >= ? GROUP BY role, region ORDER BY reports DESC', from))
    .map(row => ({...row, share: row.in_places ? row.matched / row.in_places : null}));
  const missed = (await rows(db, 'SELECT term, SUM(count) AS count, SUM(reports) AS reports FROM intel_missed WHERE day >= ? GROUP BY term ORDER BY count DESC LIMIT 15', from))
    .map(row => ({...row, perReport: row.reports ? Math.round(row.count / row.reports) : 0}));
  const dismiss = await rows(db, 'SELECT reason, bucket, SUM(n) AS n FROM intel_dismiss WHERE day >= ? GROUP BY reason, bucket', from);
  const snapshot = await rows(db, 'SELECT bucket, state, SUM(n) AS n FROM intel_scores WHERE day >= ? GROUP BY bucket, state', from);
  const byBucket = {};
  for (const row of snapshot) (byBucket[row.bucket] ||= {total: 0, states: {}}).states[row.state] = row.n;
  for (const entry of Object.values(byBucket)) entry.total = Object.values(entry.states).reduce((sum, n) => sum + n, 0);
  const reached = states => bucket => (byBucket[bucket]?.total ? states.reduce((sum, s) => sum + (byBucket[bucket].states[s] || 0), 0) / byBucket[bucket].total : null);
  const acted = reached(['saved', 'applying', 'applied', 'screening', 'interviewing', 'offer', 'rejected', 'no_response', 'withdrawn']);
  const heard = reached(['screening', 'interviewing', 'offer']);
  const scores = BUCKETS.filter(bucket => byBucket[bucket]).map(bucket => ({bucket, total: byBucket[bucket].total, states: byBucket[bucket].states,
    acted: acted(bucket), interviewed: heard(bucket), dismissed: reached(['dismissed'])(bucket)}));
  // Among applications with a marked outcome, the share that got a reply or better, per score band; a band under 20 outcomes is too thin to compare.
  const marked = {};
  for (const row of await rows(db, 'SELECT bucket, outcome, SUM(n) AS n FROM intel_replies WHERE day >= ? GROUP BY bucket, outcome', from)) (marked[row.bucket] ||= {})[row.outcome] = row.n;
  const replies = BUCKETS.filter(bucket => marked[bucket]).map(bucket => {
    const total = Object.values(marked[bucket]).reduce((sum, n) => sum + n, 0), good = GOOD.reduce((sum, o) => sum + (marked[bucket][o] || 0), 0);
    return {bucket, total, good, rate: total >= 20 ? good / total : null};
  });
  const sources = (await rows(db, 'SELECT board, SUM(seen) AS seen, SUM(acted) AS acted, SUM(dismissed) AS dismissed, SUM(heard) AS heard FROM intel_sources WHERE day >= ? GROUP BY board ORDER BY seen DESC', from))
    .map(row => ({...row, actedShare: row.seen ? row.acted / row.seen : null, dismissedShare: row.seen ? row.dismissed / row.seen : null, heardShare: row.acted ? row.heard / row.acted : null}));
  const fixes = (await rows(db, 'SELECT label, filled, corrected, installs FROM intel_fixes WHERE filled >= 10 ORDER BY CAST(corrected AS REAL) / filled DESC, filled DESC LIMIT 20'))
    .filter(row => { try { return JSON.parse(row.installs).length >= MIN_PEOPLE; } catch { return false; } }).map(({installs, ...row}) => ({...row, rate: row.corrected / row.filled}));
  const left = await rows(db, 'SELECT reason, SUM(n) AS n FROM fill_reasons WHERE day >= ? GROUP BY reason', from).catch(() => []);
  const leftTotal = left.reduce((sum, row) => sum + row.n, 0);
  const reasons = LEFT_REASONS.filter(reason => left.some(row => row.reason === reason)).map(reason => {
    const n = left.find(row => row.reason === reason).n;
    return {reason, n, share: n / leftTotal};
  }).sort((a, b) => b.n - a.n);
  const cost = await aiCost(db, days, now);
  return {days, calibration: calibration(replies), hints: await hints(db, now), replies, sources, fixes, reasons, cost, terms: shown.map(row => ({term: row.term, n: row.n, where: where[row.term] || []})), hiddenTerms: terms.length - shown.length,
    coverage, missed, dismiss, scores};
}

const esc = value => String(value ?? '').replace(/[&<>"]/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[ch]));

export function page(data) {
  const dismissTotals = REASONS.map(reason => [reason, data.dismiss.filter(row => row.reason === reason).reduce((sum, row) => sum + row.n, 0)]).filter(([, n]) => n);
  const dismissAll = dismissTotals.reduce((sum, [, n]) => sum + n, 0);
  const range = [7, 30, 90].map(n => (n === data.days ? `<b>${n} days</b>` : `<a href="?days=${n}">${n} days</a>`)).join(' · ');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Job Pilotto intelligence</title><link rel="icon" href="/favicon-32.png">
<style>
:root{--bg:#0b0d10;--card:#14181d;--line:#262c33;--text:#f4efe3;--muted:#8d949c;--amber:#f5b54a;--red:#e5776b;--teal:#5ec4b6}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,-apple-system,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 48px}h1{margin:0;font-size:24px}h2{margin:0 0 6px;font-size:15px}a{color:var(--amber)}.muted{color:var(--muted)}
header{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:18px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;margin-bottom:12px;min-width:0}
table{width:100%;border-collapse:collapse;margin-top:8px}th{text-align:left;font-size:12px;color:var(--muted);font-weight:600;padding:6px 4px}
td{padding:8px 4px;border-top:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}.bar{height:8px;border-radius:99px;background:var(--amber);min-width:2px}
</style></head><body><main>
<header><div><h1>🧠 What the installs teach</h1><small class="muted">Counts only, by coarse tags: no job title, company or text. A role word is named only once ${MIN_PEOPLE}+ people chose it.</small></div>
<div class="muted">Last ${range} · <a href="/telemetry">App reports</a> · <a href="/stats">Stats</a> · <a href="/intelligence">Public page</a></div></header>
<section class="card"><h2>🔎 Is the search too narrow?</h2><small class="muted">Share of postings in people's wanted places that their role keywords catch (reports from each crawl), by role and region.</small>
<table><tr><th>Role</th><th>Region</th><th>Reports</th><th>Keywords catch</th></tr>
${data.coverage.map(row => `<tr><td>${esc(row.role)}</td><td>${esc(row.region)}</td><td>${row.reports}</td><td>${pct(row.share)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No crawl reports yet.</td></tr>'}</table>
<table><tr><th>Role word the keywords miss</th><th>Postings per report</th><th>Reports</th></tr>
${data.missed.map(row => `<tr><td>${esc(row.term)}</td><td>${row.perReport}</td><td>${row.reports}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Nothing yet.</td></tr>'}</table></section>
<section class="card"><h2>➕ Role words people accept</h2><small class="muted">From the card's one-click add. This becomes the starter keyword pack for new searches.</small>
<table><tr><th>Word</th><th>People</th><th>Role / region</th></tr>
${data.terms.map(row => `<tr><td>${esc(row.term)}</td><td><b>${row.n}</b></td><td class="muted">${esc(row.where.slice(0, 4).join(' · '))}</td></tr>`).join('') || `<tr><td colspan="3" class="muted">No word chosen by ${MIN_PEOPLE}+ people yet${data.hiddenTerms ? ` (${data.hiddenTerms} chosen by fewer)` : ''}.</td></tr>`}</table></section>
<section class="card"><h2>🙅 Why jobs are dismissed</h2><small class="muted">${data.hints.length ? `Shipped to apps as scoring hints: ${esc(data.hints.map(h => `${h.reason} ${Math.round(h.share * 100)}%`).join(', '))}.` : 'No scoring hint shipped yet (needs 50+ dismissals, a reason at 30%+).'}</small><br><small class="muted">The one-tap reason after Dismiss. If most reasons are "seniority", the filters or the extraction need work.</small>
<table>${dismissTotals.map(([reason, n]) => `<tr><td style="width:110px">${esc(reason)}</td><td><div class="bar" style="width:${Math.round(n / dismissAll * 100)}%"></div></td><td style="width:80px"><b>${n}</b> · ${Math.round(n / dismissAll * 100)}%</td></tr>`).join('') || '<tr><td class="muted">No reasons yet.</td></tr>'}</table></section>
<section class="card"><h2>🎯 Does the score predict action?</h2><small class="muted">Per fit-score band: the share of jobs that were acted on (saved, applied or past it), dismissed, or reached a call or interview. If the 80+ band is not clearly better than 60–79, the scoring rubric needs fixing.</small>
<table><tr><th>Score band</th><th>Jobs seen</th><th>Acted on</th><th>Dismissed</th><th>Reached a call / interview</th></tr>
${data.scores.map(row => `<tr><td>${esc(row.bucket)}</td><td>${row.total}</td><td>${pct(row.acted)}</td><td>${pct(row.dismissed)}</td><td>${pct(row.interviewed)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No snapshots yet.</td></tr>'}</table></section>
<section class="card"><h2>📬 Do higher scores get replies?</h2><small class="muted">Of the applications people marked, the share that got a reply, a call or an offer, per fit-score band (shown from 20 outcomes). Calibrates the scoring.</small>
<p><b>${data.calibration.status === 'ok' ? '✅' : data.calibration.status === 'thin' ? '⏳' : '⚠️'} ${esc(data.calibration.note)}</b></p>
<table><tr><th>Score band</th><th>Outcomes marked</th><th>Reply or better</th></tr>
${data.replies.map(row => `<tr><td>${esc(row.bucket)}</td><td>${row.total}</td><td>${pct(row.rate)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No marked outcomes yet.</td></tr>'}</table></section>
<section class="card"><h2>🧭 Which sources give useful jobs?</h2><small class="muted">Per job-board kind: the share of jobs people acted on or dismissed, and of the acted ones, how many got a call. "other" is every company site.</small>
<table><tr><th>Source</th><th>Jobs seen</th><th>Acted on</th><th>Dismissed</th><th>Heard back (of acted)</th></tr>
${data.sources.map(row => `<tr><td>${esc(row.board)}</td><td>${row.seen}</td><td>${pct(row.actedShare)}</td><td>${pct(row.dismissedShare)}</td><td>${pct(row.heardShare)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No snapshots yet.</td></tr>'}</table></section>
<section class="card"><h2>✏️ Answers people change</h2><small class="muted">Questions the filler answered that the person then edited by hand, once ${MIN_PEOPLE}+ people and 10+ fills have reported them. The top of this list is where the alias or profile mapping is wrong.</small>
<table><tr><th>Question wording</th><th>Filled</th><th>Changed by hand</th></tr>
${data.fixes.map(row => `<tr><td>${esc(row.label)}</td><td>${row.filled}</td><td><b>${pct(row.rate)}</b></td></tr>`).join('') || '<tr><td colspan="3" class="muted">Nothing reported by enough people yet.</td></tr>'}</table></section>
<section class="card"><h2>🕳️ Why fields stay empty</h2><small class="muted">Fields the filler left empty, by reason (all boards). "No answer" means the profile has nothing for it; "not taken" means the field refused the value; "real click" and "no option" are dropdowns.</small>
<table><tr><th>Reason</th><th>Fields</th><th>Share</th></tr>
${data.reasons.map(row => `<tr><td>${esc(REASON_TEXT[row.reason] || row.reason)}</td><td>${row.n}</td><td>${pct(row.share)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Nothing reported yet.</td></tr>'}</table></section>
<section class="card"><h2>💸 What the AI costs us</h2><small class="muted">Included AI through the relay (founder and friend keys today, Pro later): money per step and per user per active day. This is what a pass price and a credit budget must cover.</small>
<table><tr><th>Users</th><th>Total</th><th>Per user per active day</th><th>Median · 95th · max</th><th>Per user per month</th></tr>
<tr><td>${data.cost.users}</td><td>$${data.cost.total.toFixed(2)}</td><td>$${data.cost.perUserDay.mean.toFixed(3)}</td><td>$${data.cost.perUserDay.median.toFixed(3)} · $${data.cost.perUserDay.p95.toFixed(3)} · $${data.cost.perUserDay.max.toFixed(3)}</td><td><b>$${data.cost.monthPerActiveUser.toFixed(2)}</b></td></tr></table>
<table><tr><th>Step</th><th>Calls</th><th>Cost</th><th>Per call</th></tr>
${data.cost.steps.map(row => `<tr><td>${esc(row.action)}</td><td>${row.calls}</td><td>$${row.usd.toFixed(3)}</td><td>$${row.perCall.toFixed(4)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No relay calls yet. Steps are labelled by the app, so an older app shows as "other".</td></tr>'}</table></section>
</main></body></html>`;
}

// GET /intel?days=30 (the /stats key or cookie)
export async function view(request, env, now = new Date()) {
  if (!allowed(request, env) || !env.STATS) return new Response('Not found', {status: 404});
  const asked = Number(new URL(request.url).searchParams.get('days'));
  const data = await report(env.STATS, [7, 30, 90].includes(asked) ? asked : 30, now);
  return new Response(page(data), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'}});
}
