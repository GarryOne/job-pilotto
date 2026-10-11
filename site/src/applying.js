// /admin/applying: are applications reliable? Layers 2 and 3 of the applying reliability spec (docs/superpowers/specs/2026-10-10-applying-reliability-layers.md):
// the recorded pages (each case, passed or failed, by run) and the nightly live smoke (each site: the step it reached, its last runs, regressions), plus the
// fleet's dropped boards (layer 4, src/digest.js). The owner's Mac uploads each run (POST here, the owner key; desktop/e2e/lib/applying-report.mjs): the
// site's host and fixed words only, never a posting's address or applicant data. Guard: test/applying.test.js.
import {viewer} from './auth.js';
import {FIX_KINDS, FIXED_CSS, FIXED_SCRIPT, fixedData, ingestFixes} from './applying-fixed.js';
import {ORDER_SOURCE} from './applying-order.js';
import {GROUPS_SOURCE, newestVersion} from './applying-groups.js';
import {digest} from './digest.js';
import {topCauses} from './applying-cause.js';
import {nextToAdd} from './nextsites.js';
import {platformScorecard} from './scorecard.js';
import {displayName, flowOf, platformLabel, SIGNATURE, signatureHost} from './platform.js';

export const STEPS = ['none', 'posting', 'account', 'code/bot', 'form', 'ready'];
const KINDS = ['smoke', 'recorded', 'pool', 'running'];
const RUNNING_MINUTES = 5;   // a start ping older than this is a run that died
const DAY = /^\d{4}-\d\d-\d\d$/;
const text = (value, max) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const SIGNALS = ['unsure', 'contradicted', 'stalled', 'failed'];   // why a rung handed the page on (the AI ladder spec): fixed words only
const rungOf = value => (Number.isInteger(value) && value >= 0 && value <= 6 ? value : null);
const int = value => (Number.isInteger(value) && value >= 0 && value < 10000 ? value : null);
const hostOf = value => { const host = text(value, 120).toLowerCase(); return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? host : null; };

// -> {ok, stored} | {ok: false, error}. body: {kind, day, version, rows: [{name, start_host?, signature?} for 'pool'; {name, host?, reached?, filled?, left?, ok?, note?, regression?}]}
export async function ingest(db, body, now = new Date()) {
  if (FIX_KINDS.includes(body?.kind)) return ingestFixes(db, body, now);   // the fix ledger and the claims: snapshots (src/applying-fixed.js)
  const kind = KINDS.includes(body?.kind) ? body.kind : null, day = DAY.test(body?.day || '') ? body.day : null;
  const rows = Array.isArray(body?.rows) ? body.rows.slice(0, 200) : [];
  if (!kind || !day || !rows.length) return {ok: false, error: 'kind, day and rows are required'};
  const version = text(body.version, 20) || null, at = now.toISOString();
  let stored = 0;
  for (const row of rows) {
    const name = text(row?.name, 120);
    if (!name) continue;
    if (kind === 'running') {   // a site starts or ends its run: fixed words only
      if (row.state === 'start') await db.prepare('INSERT INTO applying_running (name, at) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET at = excluded.at').bind(name, at).run();
      else if (row.state === 'end') await db.prepare('DELETE FROM applying_running WHERE name = ?').bind(name).run();
      else continue;
      stored += 1; continue;
    }
    if (kind === 'pool') {   // a pool site: its start host and flow signature, fixed words only (a later row without them keeps what is known)
      const signature = SIGNATURE.test(text(row.signature, 200)) ? text(row.signature, 200) : null;
      await db.prepare(`INSERT INTO applying_pool (name, start_host, signature, at, version) VALUES (?, ?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET
        start_host = COALESCE(excluded.start_host, start_host), signature = COALESCE(excluded.signature, signature), at = excluded.at, version = excluded.version`)
        .bind(name, hostOf(row.start_host), signature, at, version).run();
      stored += 1; continue;
    }
    await db.prepare(`INSERT INTO applying_runs (kind, day, at, name, host, reached, filled, left_n, ok, note, regression, version, rung, signal, asked, unexplained) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(kind, day, at, name, kind === 'smoke' ? hostOf(row.host) : null, kind === 'smoke' && STEPS.includes(row.reached) ? row.reached : null,
        int(row.filled), int(row.left), kind === 'recorded' ? (row.ok ? 1 : 0) : null, text(row.note, 200) || null, row.regression ? 1 : 0, version,
        rungOf(row.rung), kind === 'smoke' && SIGNALS.includes(row.signal) ? row.signal : null,
        kind === 'smoke' ? int(row.asked) : null, kind === 'smoke' ? int(row.unexplained) : null).run();
    stored += 1;
  }
  return {ok: true, stored};
}

const all = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results || [];
const dayOf = date => date.toISOString().slice(0, 10);

// A shortfall as the page sees it (the upload carries counts only; the runner's own rule is desktop/e2e/lib/smoke.mjs shortfall, same threshold): the form was reached and fewer than half of its fields are filled.
export const shortOf = (reached, filled, left, asked = null, unexplained = null) => {
  if (reached !== 'form') return null;
  // The runner's verdict (desktop/e2e/lib/smoke.mjs shortfall: a left field is expected when we really did not know it AND suggested an answer, or when it is a legal choice): the asked fields and how many
  // are unexplained, a miss or without a suggestion. Without it (an older run) the counts decide: under half filled.
  if (Number.isInteger(asked) && Number.isInteger(unexplained)) return unexplained > 0 ? {done: asked - unexplained, total: asked, unexplained} : null;
  return Number.isInteger(filled) && Number.isInteger(left) && filled + left > 0 && filled / (filled + left) < 0.5 ? {done: filled, total: filled + left, unexplained: null} : null;
};
const shareOf = (filled, left) => (Number.isInteger(filled) && Number.isInteger(left) && filled + left > 0 ? Math.round((100 * filled) / (filled + left)) : null);
// Needs a fix: not a posting that is gone, and a regression, a shortfall, or a stop before the form (a code or bot check is a documented hold, not a fix).
const runNeedsFix = run => (run.note ? null : !run.reached ? null : !!run.regression || !!shortOf(run.reached, run.filled, run.left_n, run.asked, run.unexplained) || ['none', 'posting', 'account'].includes(run.reached));
const needsFix = site => !site.note && !!site.reached && (site.regression || !!site.short || ['none', 'posting', 'account'].includes(site.reached));

export async function data(db, now = new Date()) {
  const since = dayOf(new Date(now.getTime() - 30 * 86400000)), tenDays = dayOf(new Date(now.getTime() - 9 * 86400000));
  const runs = await all(db, 'SELECT * FROM applying_runs WHERE day >= ? ORDER BY day, id', since);
  const byName = kind => runs.filter(run => run.kind === kind).reduce((out, run) => ((out[run.name] ||= []).push(run), out), {});
  const sites = Object.entries(byName('smoke')).map(([name, list]) => {
    const last = list.at(-1);
    return {name, at: last.at, host: last.host, runs: list.slice(-20).map(run => ({day: run.day, at: run.at, reached: run.reached, filled: run.filled, left: run.left_n, version: run.version, needsFix: runNeedsFix(run)})), reached: last.reached, filled: last.filled, left: last.left_n, day: last.day, version: last.version, note: last.note, rung: last.rung ?? null, signal: last.signal ?? null,
      regression: !!last.regression, short: shortOf(last.reached, last.filled, last.left_n, last.asked, last.unexplained), shares: list.slice(-10).map(run => shareOf(run.filled, run.left_n)), history: list.slice(-10).map(run => run.reached || 'none'), days: list.slice(-10).map(run => run.day)};
  }).sort((a, b) => Number(b.regression) - Number(a.regression) || STEPS.indexOf(a.reached) - STEPS.indexOf(b.reached));
  const cases = Object.entries(byName('recorded')).map(([name, list]) => {
    const last = list.at(-1);
    return {name, ok: !!last.ok, note: last.note, day: last.day, version: last.version, rung: last.rung ?? null, since: list[0].day, history: list.slice(-10).map(run => (run.ok ? 1 : 0))};
  }).sort((a, b) => Number(a.ok) - Number(b.ok) || a.name.localeCompare(b.name));
  const nights = Object.entries(runs.filter(run => run.kind === 'smoke').reduce((out, run) => {
    const counts = (out[run.day] ||= Object.fromEntries(STEPS.map(step => [step, 0])));
    counts[run.reached || 'none'] += 1;
    return out;
  }, {})).map(([day, counts]) => ({day, counts}));
  const pool = await poolRows(db, sites, now);
  const causes = await topCauses(db, pool.map(item => item.shape), now).catch(() => ({}));   // the pool's own fill cards: why the form's fields stayed empty (src/applying-cause.js)
  for (const item of pool) item.cause = causes[item.shape] || null;
  const scorecard = await platformScorecard(db, pool, now).catch(() => []);   // real use against the pool's tests, per platform (src/scorecard.js)
  const next = await nextToAdd(db, pool, now).catch(() => ({sites: [], hidden: {hosts: 0}}));   // real users' end hosts the pool lacks (src/nextsites.js)
  const fixed = await fixedData(db, pool, cases, now).catch(() => ({day: dayOf(now), rows: [], inProgress: [], claimsAt: null, fixesAt: null, replays: []}));   // the Fixed tab, and the Back / In progress marks on the pool rows
  const latestBuild = newestVersion(fixed.rows.flatMap(row => row.fixes.map(fix => fix.extensionVersion))) || newestVersion(runs.map(run => run.version));   // the newest build the fix ledger names (a build that landed a fix), else the newest any run reports (src/applying-groups.js)
  const live = sites.filter(site => !site.note);
  const dropped = await digest(db, now).then(d => d.boards.filter(board => board.dropped).map(board => ({board: board.board, earlier: board.earlierFilledShare, recent: board.recentFilledShare}))).catch(() => []);
  return {
    tiles: {
      cases: cases.length, casesFailing: cases.filter(item => !item.ok).length, casesLast: cases.map(item => item.day).sort().at(-1) || null,
      sites: sites.length, sitesRecent: sites.filter(site => site.day >= tenDays).length,
      reachedForm: live.length ? Math.round((100 * live.filter(site => ['form', 'ready'].includes(site.reached)).length) / live.length) : null,
      needFix: sites.filter(needsFix).length, regressions: sites.filter(site => site.regression).length, gone: sites.filter(site => site.note).length, dropped: dropped.length},
    sites, pool, fixed, latestBuild, next, scorecard, platforms: counts(pool, 'platform', 'flow'), flows: counts(pool, 'flow', 'platform').filter(item => item.name !== '—'), cases, nights, dropped, steps: STEPS, now: now.toISOString()};
}

// "Greenhouse: 4 sites, 3 flows": each group's size and how many different flows (or platforms) it holds.
const counts = (pool, key, other) => Object.entries(pool.reduce((out, item) => ((out[item[key] ?? '—'] ||= []).push(item), out), {}))
  .map(([name, list]) => ({name, sites: list.length, flows: new Set(list.map(item => item[other]).filter(Boolean)).size})).sort((a, b) => b.sites - a.sites || a.name.localeCompare(b.name));

// Every pool site (also one never run), joined with its smoke runs by name; a site that ran before it was uploaded as pool still shows, by its run host.
async function poolRows(db, sites, now) {
  const uploaded = await all(db, 'SELECT * FROM applying_pool ORDER BY name'), known = new Map(uploaded.map(row => [row.name, row]));
  const names = [...new Set([...uploaded.map(row => row.name), ...sites.map(site => site.name)])];
  const byName = Object.fromEntries(sites.map(site => [site.name, site])), fresh = new Date(now.getTime() - RUNNING_MINUTES * 60000).toISOString();
  const running = new Set((await all(db, 'SELECT name FROM applying_running WHERE at > ?', fresh)).map(row => row.name));
  return names.map(name => {
    const row = known.get(name) || {}, site = byName[name], start = row.start_host || site?.host || '', end = signatureHost(row.signature) || '';
    const {flow, raw} = flowOf(row.signature, start);
    const step = row.signature?.match(/#([^#]+)$/)?.[1] || null, reached = site?.reached ?? step;
    return {name: displayName(name, start), shape: name, version: site?.version ?? null, runs: site?.runs ?? [], platform: platformLabel(end, start), flow, raw, start, end, reached, day: site?.day ?? null, at: site?.at ?? null, running: running.has(name), note: site?.note ?? null, rung: site?.rung ?? null, signal: site?.signal ?? null,
      regression: !!site?.regression, filled: site?.filled ?? null, left: site?.left ?? null, short: site?.short ?? null, shares: site?.shares ?? [], history: site?.history ?? (step ? [step] : []), days: site?.days ?? []};
  }).sort((a, b) => Number(b.running) - Number(a.running) || a.platform.localeCompare(b.platform) || a.name.localeCompare(b.name));
}

// The owner removes one uploaded run (a case that should never have been sent): DELETE with {kind: 'recorded'|'smoke', day, name}. Nothing else is deleted.
export async function forget(db, body) {
  const kind = body?.kind, day = text(body?.day, 10), name = text(body?.name, 200);
  if (!kind || !day || !name) return {ok: false, error: 'kind, day and name are needed'};
  if (!['recorded', 'smoke'].includes(kind)) return {ok: false, error: 'kind must be recorded or smoke'};
  const done = await db.prepare('DELETE FROM applying_runs WHERE kind = ? AND day = ? AND name = ?').bind(kind, day, name).run();
  return {ok: true, removed: done?.meta?.changes ?? done?.changes ?? 0};
}

export async function view(request, env, now = new Date()) {
  if (!await viewer(request, env) || !env.STATS) return new Response('Not found', {status: 404});
  const noStore = {'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'};
  if (request.method === 'DELETE') {
    const result = await forget(env.STATS, await request.json().catch(() => null));
    return Response.json(result, {status: result.ok ? 200 : 400, headers: noStore});
  }
  if (request.method === 'POST') {
    const body = await request.json().catch(() => null);
    const result = await ingest(env.STATS, body, now);
    return Response.json(result, {status: result.ok ? 200 : 400, headers: noStore});
  }
  if (new URL(request.url).searchParams.has('json')) return Response.json(await data(env.STATS, now), {headers: noStore});
  return new Response(PAGE, {headers: {'Content-Type': 'text/html; charset=utf-8', ...noStore}});
}

export const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Applying tests · Admin</title><link rel="icon" href="/favicon-32.png">
<style>
:root{--bg:#0b0d10;--card:#14181d;--line:#262c33;--text:#f4efe3;--muted:#8d949c;--amber:#f5b54a;--green:#5ec47a;--red:#e5484d;--blue:#6aa8ff;--violet:#b48cff}
*{box-sizing:border-box}.tiles{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:1px;margin:14px 0;background:var(--line);border:1px solid var(--line);border-radius:12px;overflow:hidden}@media (max-width:1000px){.tiles{grid-template-columns:repeat(3,minmax(0,1fr))}}@media (max-width:520px){.tiles{grid-template-columns:repeat(2,minmax(0,1fr))}}
.tile{background:var(--card);padding:14px 16px}.tile b{display:block;font-size:26px;line-height:1.2}.tile .what{display:block;font-size:14px;margin-top:2px}.tile span.note{display:block;margin-top:4px;color:var(--muted);font-size:12px}
.tile.bad b{color:var(--red)}.tile.good b{color:var(--green)}section{margin:36px 0 0;padding-top:24px;border-top:1px solid var(--line)}section>h2{margin:0 0 12px}table{width:100%;border-collapse:collapse}
th{text-align:left;color:var(--muted);font-weight:500;font-size:12px;white-space:nowrap}td,th{padding:7px 8px 7px 0;border-bottom:1px solid var(--line);font-size:13px;vertical-align:top}
.pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600;color:#0b0d10}
.s-none{background:var(--muted)}.s-posting{background:var(--red)}.s-account{background:var(--amber)}.s-code\\/bot{background:var(--violet)}.s-form{background:var(--blue)}.s-ready{background:var(--green)}
th.sortable{cursor:pointer;user-select:none}th.sortable:hover,th.sortable.on{color:var(--text)}.dots{white-space:nowrap}.dots i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:3px}
.filters{display:flex;flex-wrap:wrap;gap:12px 20px;align-items:flex-end;margin:10px 0 12px;padding:10px 12px;background:var(--card);border:1px solid var(--line);border-radius:10px;font-size:13px}.pick{display:flex;flex-direction:column;gap:4px;min-width:200px}.pick b{line-height:34px;font-weight:600}.pick>span{font-size:11px;text-transform:uppercase;letter-spacing:.04em}.pick.search{min-width:240px}.pick input[type=search],.pick select{background:var(--bg,var(--card));color:var(--text);border:1px solid var(--line);border-radius:8px;padding:0 10px;height:34px;box-sizing:border-box;font:inherit;font-size:13px;max-width:100%}.filters .count,.filters .pager{align-self:flex-end;box-sizing:border-box;height:34px;display:flex;align-items:center}.filters .count{padding-left:4px}.filters .pager{margin:0 0 0 auto;justify-content:flex-end}.chip{background:var(--card);color:var(--text);border:1px solid var(--line);border-radius:999px;padding:3px 11px;font:inherit;font-size:12px;cursor:pointer}.pager{display:flex;gap:8px;align-items:center;justify-content:flex-end;font-size:13px}.spin{display:inline-block;width:12px;height:12px;border:2px solid var(--line);border-top-color:var(--amber);border-radius:50%;animation:spin .8s linear infinite;vertical-align:-2px;margin-right:6px}@keyframes spin{to{transform:rotate(360deg)}}.chip:disabled{opacity:.4;cursor:default}.chip.on{border-color:var(--amber);color:var(--amber)}
table td:not(:first-child),table th:not(:first-child){white-space:nowrap}.legend td:last-child{white-space:normal}section{overflow-x:auto}.legend{margin:18px auto 0;max-width:760px}.legend h3,.legend>p{text-align:center;margin:0 0 6px}.legend table{margin:0 auto}.ladder{margin:10px 0 0;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px}.ladder summary{cursor:pointer;font-weight:600}.ladder table{margin-top:8px}
.flag{color:var(--red);font-weight:600}.inprogress{color:var(--amber);font-weight:600}section[hidden]{display:none}${FIXED_CSS}.muted{color:var(--muted)}
.pooltable{table-layout:fixed}.pooltable td,.pooltable th{white-space:normal!important;overflow-wrap:anywhere}.pooltable tr.site{cursor:pointer}.pooltable tr.site:hover td,.pooltable tr.site.open td{background:var(--card)}.pooltable tr.site td{vertical-align:middle;padding:10px 10px 10px 0}
.sitecell{display:flex;gap:4px;align-items:flex-start}.pooltable th.c-site{width:30%}.pooltable th.c-flow{width:21%}.pooltable th.c-result{width:25%}.pooltable th.c-rung{width:10%}.pooltable th.c-runs{width:14%}.chev{display:inline-block;width:24px;color:var(--muted);transition:transform .15s;flex:none;background:none;border:0;padding:0 0 0 8px;font:inherit;font-size:18px;line-height:1.2;cursor:pointer}.open .chev{transform:rotate(90deg);color:var(--text)}.sitename b{display:block;font-size:14px}.sitename span{display:block;margin-top:2px}.stack{display:block;margin-top:2px}.stack.bad{color:var(--red);font-weight:600}
.rungbox{display:inline-block;min-width:32px;text-align:center;padding:3px 8px;border-radius:7px;background:var(--card);border:1px solid var(--line);font-weight:600}.pooltable td.c-rung,.pooltable th.c-rung{text-align:center}
tr.more td{padding:0 0 12px}.detail{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:16px 24px;align-items:start;margin:0;padding:12px 14px;background:var(--card);border:1px solid var(--line);border-radius:10px}.detail h4{margin:0 0 6px;font-size:12px;font-weight:500;color:var(--muted)}.detail dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 12px;margin:0;font-size:13px}.detail dt{color:var(--muted)}.detail dd{margin:0;overflow-wrap:anywhere}.copy{margin-left:8px;background:none;border:0;color:var(--muted);cursor:pointer;font:inherit;padding:0 2px}.copy:hover{color:var(--text)}.detail .narrow{display:none}
.dots i:focus-visible{outline:2px solid var(--amber);outline-offset:2px}
@media (max-width:900px){.pooltable .c-flow,.pooltable .c-runs{display:none}.pooltable th.c-site{width:50%}.pooltable th.c-result{width:36%}.pooltable th.c-rung{width:14%}.detail .narrow{display:block}.detail{grid-template-columns:minmax(0,1fr)}}
.nights{margin-top:24px;padding-top:18px}.nights .key{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px}.night{display:grid;grid-template-columns:48px minmax(0,1fr) 240px;gap:12px;align-items:center;margin:6px 0}
.nightbar{display:flex;gap:2px;height:28px;border-radius:7px;overflow:hidden}.nightbar i{display:flex;align-items:center;justify-content:center;min-width:0;font-style:normal;font-size:12px;font-weight:600;color:#0b0d10;overflow:hidden}
@media (max-width:640px){.night{grid-template-columns:44px minmax(0,1fr)}.night>span{grid-column:2}}
</style></head><body><main>
<header><h1>🛡️ Applying tests</h1></header>
<p class="muted">Is applying reliable? <b>Fixed</b> (tab): every site we fixed, whether a run after the fix confirmed it, and its replay offline with the real extension (every e2e run, and a push touching the extension). <b>Nightly smoke</b>: real postings,
live, stopped before any account button or Submit, a rotating share each night. A site that reached less than its last run is a regression. Logs and screenshots stay on the Mac.</p>
<div id="app"><p class="muted">Loading…</p></div>
<script>
const __name = target => target;   // the bundler wraps inner functions in __name(...) (esbuild keepNames); a pasted function source calls it, so the page defines it (test/needs-fix-order.test.js)
const needsFixOrder = ${ORDER_SOURCE};
const needsFixGroups = ${GROUPS_SOURCE};
const el = (tag, props = {}, ...kids) => { const node = Object.assign(document.createElement(tag), props); node.append(...kids.filter(kid => kid != null)); return node; };
const pill = step => el('span', {className: 'pill s-' + step, textContent: step});
const color = step => getComputedStyle(document.querySelector('.s-' + CSS.escape(step)) || document.body).backgroundColor;
let serverNow = Date.now();
const ago = at => { const minutes = Math.max(0, Math.round((serverNow - Date.parse(at)) / 60000)); return minutes < 1 ? 'just now' : minutes < 60 ? minutes + ' min ago' : minutes < 1440 ? Math.round(minutes / 60) + ' h ago' : Math.round(minutes / 1440) + ' d ago'; };
const tile = (value, label, tone, note, title) => el('div', {className: 'tile ' + (tone || ''), title: title || ''}, el('b', {textContent: value ?? '–'}), el('span', {className: 'what', textContent: label}), note ? el('span', {className: 'note', textContent: note}) : null);
fetch('?json').then(r => r.json()).then(d => {
  serverNow = Date.parse(d.now);
  const app = document.getElementById('app'); app.textContent = '';
  const legend = el('div', {hidden: true}, ...d.steps.map(step => pill(step))); app.append(legend);
  const t = d.tiles;
  app.append(el('div', {className: 'tiles'},
    tile(t.cases ? (t.cases - t.casesFailing) + ' / ' + t.cases : 0, 'Replay checks passing', t.casesFailing ? 'bad' : t.cases ? 'good' : '', t.casesLast ? 'Last replay · ' + t.casesLast : 'No replay yet', 'Fixed-site replays: the recorded pages of every fixed site, replayed offline'),
    tile(t.sites ? t.sitesRecent + ' / ' + t.sites : 0, 'Smoke sites tested', '', 'Last 10 nights', 'Smoke sites run in the last 10 nights'),
    tile(t.reachedForm == null ? '–' : t.reachedForm + '%', 'Reached the form', t.reachedForm >= 70 ? 'good' : '', 'Of live smoke sites', 'Sites that reached the application form'),
    tile(t.regressions, 'Open regressions', t.regressions ? 'bad' : 'good', t.gone ? t.gone + ' posting(s) gone' : 'Reached less than before', 'A site that reached less than its last run' + (t.gone ? '; ' + t.gone + ' posting(s) are gone' : '')),
    tile(t.needFix, 'Sites needing a fix', t.needFix ? 'bad' : 'good', 'Stopped early, unexplained fields, or a regression', 'Stopped early, unexplained fields, or a regression'),
    tile(t.dropped, 'Boards dropped', t.dropped ? 'bad' : 'good', 'Fleet · layer 4', 'Boards dropped in the fleet (layer 4)')));
  const tabs = el('nav', {className: 'tabs', role: 'tablist', 'aria-label': 'Applying results'}), fixBox = el('section', {className: 'fix'}), fixedBox = el('section', {className: 'fixed'}), causeBox = el('section', {className: 'bycause'}); app.append(tabs, fixBox, fixedBox, causeBox);   // Needs a fix: right under the tiles, drawn once block() exists (drawFix)
  // Nights · where each site got to (owner, 10 Oct 2026: more readable, at the top): one bar per night, newest first, every site of that night split by the step it reached
  // (the segment's width is its share, its number the count), then how many sites ran and the share that reached the form.
  if (d.nights.length) {
    const rows = d.nights.slice(-14).reverse().map(night => { const total = d.steps.reduce((sum, step) => sum + night.counts[step], 0), form = night.counts.form + night.counts.ready;
      return el('div', {className: 'night'}, el('b', {textContent: night.day.slice(5)}),
        el('div', {className: 'nightbar'}, ...d.steps.filter(step => night.counts[step]).map(step => { const count = night.counts[step];
          return el('i', {className: 's-' + step, title: step + ': ' + count + ' of ' + total, style: 'flex:' + count + ' 1 0', textContent: count}); })),
        el('span', {className: 'muted', textContent: total + (total === 1 ? ' site' : ' sites') + ' · ' + (total ? Math.round(100 * form / total) : 0) + '% reached the form'})); });
    app.append(el('section', {className: 'nights'}, el('h2', {textContent: 'Nights · where each site got to'}),
      el('p', {className: 'muted', textContent: 'Each bar is the sites of one night, split by the step they reached (the colors are explained under the pool table); the last 14 nights, the latest first.'}),
      el('div', {className: 'key'}, ...d.steps.map(step => pill(step))), ...rows));
  }
  // The AI ladder (owner, 10 Oct 2026): where each decision of a page is made, cheapest first; collapsed by default.
  const RUNGS = [[0, 'Structure rule, no AI', 'free', 'extension/tab-pages.js pageRole'], [1, 'Kept answer per page shape', 'free', 'page-kinds.json, kept by desktop/lib/server-pages.js'], [2, 'Text sketch to the small model', 'about 600 tokens', 'desktop/lib/page-kind.js'],
    [3, 'Numbered digest to a small or middle model', 'about 1,500 to 2,500 tokens', 'desktop/lib/ladder/rung3-digest.js, extension/ladder/rung3-candidates.js'], [4, 'Screenshot plus sketch to the strongest model, one action', 'about 1.5k tokens plus the sketch, capped', 'desktop/lib/ladder/rung4-picture.js'],
    [5, 'Claude takes over the page', 'a full agent session', 'desktop/lib/ladder/rung5-takeover.js'], [6, 'The person, with the page\\'s sentence quoted', 'the person\\'s time', 'the session card']];
  app.append(el('details', {className: 'ladder'}, el('summary', {textContent: 'The AI ladder · which rung decides a page'}),
    el('table', {}, el('tr', {}, ...['Rung', 'What it is', 'Cost', 'Where it lives'].map(h => el('th', {textContent: h}))),
      ...RUNGS.map(([n, what, cost, where]) => el('tr', {}, el('td', {textContent: n}), el('td', {textContent: what}), el('td', {className: 'muted', textContent: cost}), el('td', {className: 'muted', textContent: where})))),
    el('p', {className: 'muted', textContent: 'A rung that is unsure or contradicted hands the page to the next; a rung never guesses.'})));
  // What the colors mean (owner, 10 Oct 2026): the badge and the dots of the pool table are the step a run reached, not how well the form was filled.
  const COLORS = {none: 'grey', posting: 'red', account: 'amber', 'code/bot': 'violet', form: 'blue', ready: 'green'};   // the page's own --muted, --red, --amber, --violet, --blue, --green
  const MEANS = {none: 'nothing reached, or never run (the dash)', posting: 'stopped at the job posting, never got past it', account: 'reached an account or sign-in page', 'code/bot': 'stopped at an email code or a bot check (a documented hold)', form: 'reached the application form', ready: 'the form is filled with nothing required left'};
  const SHORT_ROW = el('tr', {}, el('td', {}, el('span', {className: 'pill s-posting', textContent: 'red · form'})), el('td', {textContent: 'form, unexplained fields'}), el('td', {className: 'muted', textContent: 'reached the form, but some fields were left without a good reason (the extension missed them, or no answer was suggested; a question only the person can answer, with a suggestion shown, is fine): it counts as a failure and goes on the "Needs a fix" list'}));
  const colorLegend = el('div', {className: 'legend'}, el('h3', {textContent: 'What the colors mean'}),   // the foot of the pool table (owner, 10 Oct 2026)
    el('p', {className: 'muted', textContent: 'On the pool table, the dots of "Recent runs" (hover one for its date) show the step a run reached; a red "3 unexplained of 12" under "Form reached" means the form was reached but fields were left that we should have known or suggested an answer for. In the Fixed tab, in the Guard column, a dot is green when the case passed and red when it failed.'}),
    el('table', {}, el('tr', {}, ...['Color', 'Step', 'Meaning'].map(h => el('th', {textContent: h}))),
      ...d.steps.map(step => el('tr', {}, el('td', {}, el('span', {className: 'pill s-' + step, textContent: COLORS[step] || step})), el('td', {textContent: step}), el('td', {className: 'muted', textContent: MEANS[step] || ''}))), SHORT_ROW));
  const dots = (list, days = []) => el('span', {className: 'dots'}, ...list.map((step, at) => el('i', {title: (days[at] ? days[at] + ' · ' : '') + (typeof step === 'number' ? (step ? 'passed' : 'failed') : step), tabIndex: 0, style: 'background:' + (typeof step === 'number' ? (step ? 'var(--green)' : 'var(--red)') : color(step))})));
  // Sortable columns (owner, 10 Oct 2026: all the red ones first): every table's header sorts ascending, then descending, then back to the page's own order. The choice is kept per
  // table across the 15 s redraw. Empty cells go last either way. For a step or a run, ascending is the worst first (red before blue); the page's own order keeps running sites on top.
  const sorts = {}, rankOf = step => (typeof step === 'number' ? step : d.steps.indexOf(step));
  const blank = value => value == null || value === '' || (typeof value === 'number' && isNaN(value));
  const sortRows = (key, rows, getters) => { const pick = sorts[key]; if (!pick || !getters[pick.col]) return rows; const dir = pick.dir === 'desc' ? -1 : 1;
    return rows.map((row, index) => ({row, index, value: getters[pick.col](row)})).sort((a, b) => (blank(a.value) - blank(b.value)) || (blank(a.value) ? 0 : a.value < b.value ? -dir : a.value > b.value ? dir : 0) || a.index - b.index).map(item => item.row); };
  const heads = (key, labels, redraw) => labels.map((label, col) => { const pick = sorts[key], on = !!pick && pick.col === col;
    const flip = () => { sorts[key] = !on ? {col, dir: 'asc'} : pick.dir === 'asc' ? {col, dir: 'desc'} : null; redraw(); };
    return el('th', {className: 'sortable' + (on ? ' on' : ''), tabIndex: 0, title: 'Sort by ' + label, textContent: label + (on ? (pick.dir === 'asc' ? ' ▲' : ' ▼') : ''), onclick: flip, onkeydown: event => { if (event.key === 'Enter') flip(); }}); });
  // The pool: every smoke site, also one never run; filters by platform and by flow combine.
  const PER = 15, chosen = {platform: null, flow: null, query: '', page: 0}, table = el('div'), bars = {};
  const pick = (key, list, label, all) => el('label', {className: 'pick'}, el('span', {className: 'muted', textContent: label}), Object.assign(el('select', {onchange: event => { chosen[key] = event.target.value || null; chosen.page = 0; draw(); }},
    el('option', {value: '', textContent: all}), ...list.map(item => el('option', {value: item.name, textContent: item.name + ' · ' + item.sites + (item.sites === 1 ? ' site' : ' sites') + (key === 'platform' ? ' · ' + item.flows + (item.flows === 1 ? ' flow' : ' flows') : '')})), ), {}));
  const count = el('span', {className: 'muted count'}), pager = el('div', {className: 'pager'}), clear = el('button', {className: 'chip', type: 'button', textContent: 'Clear', hidden: true, onclick: () => { chosen.platform = chosen.flow = null; chosen.query = ''; chosen.page = 0; filters.querySelectorAll('select').forEach(node => { node.value = ''; }); search.value = ''; draw(); }});
  // Search (owner, 11 Oct 2026): words in any order, all must match the site's name, platform, host, flow, last result, note or its "blocked at N" / regression text; it combines with the two filters.
  /*search*/ const poolText = s => [s.name, s.platform, s.start, s.end, flowText(s), s.reached ? STAGE[s.reached] || s.reached : 'not run yet', s.short ? shortText(s) : '', s.regression ? 'regression' : '', blocked(s) ? 'blocked at ' + s.rung : '', s.note, s.cause && s.cause.cause].filter(Boolean).join(' ').toLowerCase();
  const poolMatches = (s, query) => { const words = String(query || '').toLowerCase().split(/\\s+/).filter(Boolean); if (!words.length) return true; const text = poolText(s); return words.every(word => text.includes(word)); }; /*end search*/
  const search = el('input', {type: 'search', placeholder: 'Site, platform, host or result', 'aria-label': 'Search the pool', autocomplete: 'off', oninput: event => { chosen.query = event.target.value; chosen.page = 0; draw(); }});
  const filters = el('div', {className: 'filters'}, el('label', {className: 'pick search'}, el('span', {className: 'muted', textContent: 'Search'}), search), pick('platform', d.platforms, 'Platform', 'All platforms · ' + d.pool.length + ' sites'), pick('flow', d.flows, 'Flow', 'All flows'), count, clear, pager);
  // The rung that made the last decision; a site that ran and did not reach the form is "blocked at N" (red) with the signal when known, "?" when the rung is unknown.
  const blocked = s => !!s.reached && !['form', 'ready'].includes(s.reached) && s.rung != null;
  const rungCell = s => (s.rung == null ? el('span', {className: 'muted', title: 'not reported', textContent: s.reached ? '?' : '—'}) : blocked(s)
    ? el('span', {}, el('span', {className: 'flag', textContent: 'blocked at ' + s.rung}), s.signal ? el('div', {className: 'muted', textContent: s.signal}) : null) : el('span', {textContent: s.rung}));
  const shortText = s => (s.short.unexplained != null ? s.short.unexplained + ' unexplained of ' + s.short.total : s.short.done + ' of ' + s.short.total + ' filled');   // the verdict, or the old count
  const POOL_GET = [s => s.name.toLowerCase(), s => s.flow, s => (s.reached ? rankOf(s.reached) - (s.short ? 0.5 : 0) : null), s => (s.rung == null ? null : s.rung + (blocked(s) ? 10 : 0)), s => (s.history.length ? rankOf(s.history.at(-1)) : null)];
  // The pool table (owner mockup, 10 Oct 2026: five columns that fit the page, the route and the exact time in an expandable row). The site name carries its host in brackets: it moves under the name, next to the platform.
  const toggleOpen = (set, key) => { const was = set.has(key); set.clear(); if (!was) set.add(key); };   // one row open at a time in every expandable table; the key is unique (a pool row's shape, never its display name)
  const open = new Set(), STAGE = {none: 'Nothing reached', posting: 'Posting reached', account: 'Account reached', 'code/bot': 'Code or bot check', form: 'Form reached', ready: 'Ready for your check'};
  const split = s => { const host = (s.name.match(/\\(([^()\\s]+\\.[a-z]{2,})\\)/) || [])[1] || s.start; return {title: s.name.replace(/\\s*\\([^()\\s]+\\.[a-z]{2,}\\)/, ''), sub: s.platform + (host ? ' (' + host + ')' : '')}; };
  const flowText = s => (s.flow ? s.flow.replace(' and form on one page', ' + form').replace('no-form', 'no form').replace(/^./, c => c.toUpperCase()) : '—');
  const resultOf = s => [el('span', {textContent: s.reached ? STAGE[s.reached] || s.reached : 'Not run yet'}), s.short ? el('span', {className: 'stack bad', title: 'reached the form, with fields left that we should have known or suggested', textContent: shortText(s)}) : null,
    s.regression ? el('span', {className: 'stack bad', textContent: 'regression'}) : null, s.note ? el('span', {className: 'stack muted', textContent: s.note}) : null];
  const copy = text => el('button', {className: 'copy', type: 'button', title: 'Copy', 'aria-label': 'Copy ' + text, textContent: '⧉', onclick: event => { event.stopPropagation(); try { navigator.clipboard.writeText(text); } catch (error) { /* a copy is only a convenience */ } }});
  const route = s => el('div', {}, el('h4', {textContent: 'Route'}), el('dl', {}, el('dt', {textContent: 'Start'}), el('dd', {}, s.start || '…', s.start ? copy(s.start) : null), ...(s.end && s.end !== s.start ? [el('dt', {textContent: 'End'}), el('dd', {}, s.end, copy(s.end))] : [])));
  const lastRun = s => el('div', {}, el('h4', {textContent: s.at ? 'Last completed run · ' + new Date(s.at).toUTCString().slice(5, 22) + ' UTC' : 'Last completed run'}),
    el('div', {}, ...resultOf(s)), s.signal ? el('div', {className: 'muted', textContent: 'rung ' + s.rung + ' handed on: ' + s.signal}) : null,
    s.cause ? el('div', {className: 'muted', textContent: 'Top cause: ' + s.cause.cause + ' · ' + s.cause.lost + ' on ' + s.cause.nights + ' night' + (s.cause.nights === 1 ? '' : 's')}) : null);
  const siteRows = s => { const on = open.has(s.shape), flip = () => { toggleOpen(open, s.shape); draw(); }, parts = split(s), runs = () => (s.history.length ? dots(s.history, s.days) : el('span', {className: 'muted', textContent: '—'}));
    const main = el('tr', {className: 'site' + (on ? ' open' : ''), onclick: flip},
      el('td', {className: 'c-site'}, el('div', {className: 'sitecell'}, el('button', {className: 'chev', type: 'button', 'aria-expanded': String(on), 'aria-label': (on ? 'Collapse ' : 'Expand ') + parts.title, textContent: '›', onclick: event => { event.stopPropagation(); flip(); }}), el('div', {className: 'sitename'}, el('b', {textContent: parts.title}), el('span', {className: 'muted', textContent: parts.sub})))),
      el('td', {className: 'c-flow', title: s.raw || '', textContent: flowText(s)}),
      el('td', {className: 'c-result'}, ...resultOf(s), s.running ? el('span', {className: 'stack muted'}, el('i', {className: 'spin'}), 'Running now') : el('span', {className: 'stack muted', title: s.at || '', textContent: s.at ? ago(s.at) : ''})),
      el('td', {className: 'c-rung'}, blocked(s) ? el('span', {className: 'flag', title: s.signal || ''}, 'Blocked', el('span', {className: 'stack', textContent: 'at ' + s.rung})) : s.rung == null ? el('span', {className: 'muted', title: 'not reported', textContent: s.reached ? '?' : '—'}) : el('span', {className: 'rungbox', textContent: s.rung})),
      el('td', {className: 'c-runs'}, runs()));
    return on ? [main, el('tr', {className: 'more'}, el('td', {colSpan: 5}, el('div', {className: 'detail'}, route(s), lastRun(s), el('div', {className: 'narrow'}, el('h4', {textContent: 'Flow'}), el('div', {textContent: flowText(s)})), el('div', {className: 'narrow'}, el('h4', {textContent: 'Recent runs'}), runs()))))] : [main]; };
  const draw = () => { const rows = sortRows('pool', d.pool.filter(s => (!chosen.platform || s.platform === chosen.platform) && (!chosen.flow || s.flow === chosen.flow) && poolMatches(s, chosen.query)), POOL_GET), pages = Math.max(1, Math.ceil(rows.length / PER)); chosen.page = Math.min(chosen.page, pages - 1); const shown = rows.slice(chosen.page * PER, (chosen.page + 1) * PER); table.textContent = ''; count.textContent = 'Showing ' + (rows.length ? chosen.page * PER + 1 : 0) + '–' + (chosen.page * PER + shown.length) + ' of ' + rows.length + (rows.length < d.pool.length ? ' (' + d.pool.length + ' in the pool)' : ''); pager.textContent = ''; clear.hidden = !chosen.platform && !chosen.flow && !chosen.query;
    table.append(rows.length ? el('table', {className: 'pooltable'}, el('tr', {}, ...heads('pool', ['Site / platform', 'Flow', 'Last result', 'Rung', 'Recent runs'], () => { chosen.page = 0; draw(); }).map((th, at) => Object.assign(th, {className: th.className + ' ' + ['c-site', 'c-flow', 'c-result', 'c-rung', 'c-runs'][at]}))),
      ...shown.flatMap(siteRows)) : el('p', {className: 'muted', textContent: 'No site matches.'}), rows.length ? el('p', {className: 'muted', style: 'text-align:center;font-size:12px', textContent: 'Expand a row for the route and the last run.'}) : null);
    if (pages > 1) { const go = step => () => { chosen.page += step; draw(); };
      pager.append(el('button', {className: 'chip', type: 'button', textContent: '← Previous', disabled: chosen.page === 0, onclick: go(-1)}),
        el('button', {className: 'chip', type: 'button', textContent: 'Next →', disabled: chosen.page >= pages - 1, onclick: go(1)})); } };
  // Next sites to add: first the platforms most matched jobs are on that the pool covers too little (from any number of installs), then the hosts real applications ended on
  // that the pool lacks, each used by >= 3 installs (src/nextsites.js). Top 10 of each, the rest on request.
  // Each list is a bar (its title, "Showing 1-10 of N", Previous / Next) over a table: the pool table's own pattern, 10 rows a page (NEXT_PER, shared by the Fixed table).
  const nextPage = {platforms: 0, sites: 0, score: 0, fix: 0, fixed: 0, causes: 0}, NEXT_PER = 10, nextBox = el('div'), scoreBox = el('div');
  const block = (key, title, what, allRows, labels, row, none, redraw = () => drawNext(), getters = []) => {
    const rows = sortRows(key, allRows, getters), pages = Math.max(1, Math.ceil(rows.length / NEXT_PER)); nextPage[key] = Math.min(nextPage[key], pages - 1);
    const from = nextPage[key] * NEXT_PER, shown = rows.slice(from, from + NEXT_PER), go = step => () => { nextPage[key] += step; redraw(); };
    return [el('div', {className: 'filters'}, el('label', {className: 'pick'}, el('span', {className: 'muted', textContent: title}), el('b', {textContent: what})),
        el('span', {className: 'muted count', textContent: rows.length ? 'Showing ' + (from + 1) + '–' + (from + shown.length) + ' of ' + rows.length : none}),
      pages > 1 ? el('div', {className: 'pager'}, el('button', {className: 'chip', type: 'button', textContent: '← Previous', disabled: nextPage[key] === 0, onclick: go(-1)}),
        el('button', {className: 'chip', type: 'button', textContent: 'Next →', disabled: nextPage[key] >= pages - 1, onclick: go(1)})) : null),
      rows.length ? el('table', {className: key === 'fix' || key === 'causes' ? 'fixtable' : ''}, el('tr', {}, ...heads(key, labels, () => { nextPage[key] = 0; redraw(); })), ...shown.flatMap(row)) : null];
  };
  const drawNext = () => { nextBox.textContent = '';
    nextBox.append(...[...block('platforms', 'Platforms', 'Matched jobs against the pool', d.next.platforms || [], ['Platform', 'Of matched jobs', 'Of the pool', 'Pool sites', 'Installs', 'Applications'],
        s => el('tr', {}, el('td', {textContent: s.platform}), el('td', {textContent: s.matchShare + '%'}), el('td', {className: 'muted', textContent: s.poolShare + '%'}),
          el('td', {className: 'muted', textContent: s.poolSites || 'none'}), el('td', {className: 'muted', textContent: s.installs}), el('td', {className: 'muted', textContent: s.applications || '—'})),
        'Nothing under-covered', undefined, [s => s.platform, s => s.matchShare, s => s.poolShare, s => s.poolSites || 0, s => s.installs, s => s.applications || 0]),
      ...block('sites', 'Sites', 'Used by 3 or more installs', d.next.sites, ['Site', 'Platform', 'Used by', 'Applications', 'Filled, nothing left', 'Countries'],
        s => el('tr', {}, el('td', {textContent: s.host}), el('td', {textContent: s.platform + (s.poolSites ? ' · ' + s.poolSites + ' in the pool' : s.platform === 'Custom' ? '' : ' · none in the pool')}),
          el('td', {className: 'muted', textContent: s.installs + ' installs'}), el('td', {className: 'muted', textContent: s.uses}), el('td', {className: 'muted', textContent: s.readyShare + '%'}),
          el('td', {className: 'muted', textContent: s.countries.map(c => c.country + ' ' + c.installs).join(', ') || '—'})),
        'Nothing yet: a site shows once 3 installs applied on it', undefined, [s => s.host, s => s.platform, s => s.installs, s => s.uses, s => s.readyShare, s => s.countries.length])].filter(Boolean)); };   // append() writes a null as the text "null"
  app.append(el('section', {}, el('h2', {textContent: 'Next sites to add · where people apply, not in the pool'}),
    el('p', {className: 'muted', textContent: 'Platforms: the share of matched jobs on each platform against its share of the pool, from any number of installs (a platform is a name from a fixed list). Sites: the site each application ended on, listed only once 3 different installs used it' + (d.next.hidden.hosts ? ' (' + d.next.hidden.hosts + ' more are below that and stay hidden)' : '') + '; under 3 installs a country is "other". Never a posting or an address.'}), nextBox)); drawNext();
  // The platform scorecard: real use against the pool's tests, one verdict per platform (src/scorecard.js).
  const TONE = {'Not in the pool': 'posting', 'Weak in both': 'posting', 'Blind spot': 'account', 'Test failing': 'code\\/bot', Fine: 'ready'};
  const pct = value => (value == null ? '—' : value + '%');
  // Needs a fix and its worst-first order live in src/applying-order.js, one function shared with tools/needs-fix-order.mjs (the source is embedded at the top of this script).
  let ORDER = needsFixOrder(d.pool, d.scorecard, d.steps);   // recomputed on every draw: the page refreshes its data
  const useOf = s => ORDER.useOf(s);
  const filledRuns = s => (s.shares || []).filter(value => value != null);
  // The Needs a fix row (owner, 11 Oct 2026: seven columns overflowed the panel): the site with its platform, why, when; platform use, top cause and the filled runs open in the row.
  const needOpen = new Set();
  const needDetail = s => el('div', {className: 'detail'},
    el('div', {}, fixShort(s.name) !== s.name ? el('div', {}, el('h4', {textContent: 'Scenario'}), el('div', {textContent: s.name})) : null,
      el('h4', {textContent: 'Platform use'}), el('div', {textContent: useOf(s) ? useOf(s) + '% of the matched jobs' : '—'}),
      el('h4', {textContent: 'Top cause'}), el('div', {textContent: s.cause ? s.cause.cause + ' · ' + s.cause.lost + ' on ' + s.cause.nights + ' night' + (s.cause.nights === 1 ? '' : 's') : '—'})),
    el('div', {}, el('h4', {textContent: 'Filled, last runs'}), el('div', {textContent: filledRuns(s).length ? filledRuns(s).join(' → ') + '%' : '—'}),
      el('h4', {textContent: s.at ? 'Last run · ' + new Date(s.at).toUTCString().slice(5, 22) + ' UTC' : 'Last run'}), el('div', {textContent: s.at ? ago(s.at) : '—'})));
  const needRow = s => { const on = needOpen.has(s.shape), flip = () => { toggleOpen(needOpen, s.shape); drawFix(); };
    const main = el('tr', {className: 'site' + (on ? ' open' : ''), onclick: flip},
      el('td', {}, el('div', {className: 'sitename'}, el('b', {textContent: fixShort(s.name)}), el('span', {className: 'muted', textContent: s.platform + (s.start ? ' (' + s.start + ')' : '')}))),
      el('td', {}, el('span', {className: 'flag', textContent: s.regression ? 'regression' : s.short ? 'form · ' + shortText(s) : 'stopped at the ' + s.reached}),
        s.back ? el('span', {className: 'stack flag', textContent: 'Back · fixed before, listed again'}) : null, s.claimed ? el('span', {className: 'stack inprogress', textContent: 'In progress · since ' + ago(s.claimed)}) : null),
      el('td', {className: 'muted', textContent: s.at ? ago(s.at) : '—'}),
      el('td', {}, el('button', {className: 'chev', type: 'button', 'aria-expanded': String(on), 'aria-label': (on ? 'Collapse ' : 'Expand ') + s.name, textContent: '›', onclick: event => { event.stopPropagation(); flip(); }})));
    return on ? [main, el('tr', {className: 'more'}, el('td', {colSpan: 4}, needDetail(s)))] : [main]; };
  const drawFix = () => { fixBox.textContent = ''; ORDER = needsFixOrder(d.pool, d.scorecard, d.steps);
    fixBox.append(el('div', {className: 'fixpanel'}, el('div', {className: 'fixhead'}, el('h2', {textContent: 'Needs a fix · where applying stops'}),
      el('p', {className: 'muted', textContent: 'A regression, a stop before the form, or a form reached with fields left that we should have known or suggested an answer for. Open a row for the platform use, the top cause and the share of fields filled in each of the last runs: a fix shows there the next night.'})),
      ...block('fix', 'Sites', 'Worst first: regressions, then the platform most used', ORDER.rows, ['Site / platform', 'Why', 'Last run', 'Details'], needRow,
        'Nothing needs a fix', () => drawFix(), [s => s.name.toLowerCase(), s => ORDER.rank.get(s.shape), s => (s.at ? Date.parse(s.at) : null)]).filter(Boolean))); };
  // By cause (owner, 11 Oct 2026): the Needs a fix rows grouped by their top cause, biggest first, after "Run first" (rows that need a pool run, not a fix); src/applying-groups.js, shared with
  // tools/needs-fix-causes.mjs. A row opens to its sites. The session that holds a claim never reaches the site, so the column counts claimed rows.
  const causeOpen = new Set();
  const causeDetail = g => el('div', {className: 'detail'}, el('div', {}, el('h4', {textContent: g.hint || 'Sites'}),
    el('ul', {className: 'fixguard'}, ...g.rows.map(s => el('li', {}, s.name, el('span', {className: 'muted', textContent: ' · ' + s.platform + (s.at ? ' · last run ' + ago(s.at) : ' · never run') + (s.version ? ' · build ' + s.version : '') + (s.claimed ? ' · claimed' : '')}))))));
  const causeRow = g => { const on = causeOpen.has(g.key), flip = () => { toggleOpen(causeOpen, g.key); drawCauses(); };
    const main = el('tr', {className: 'site' + (on ? ' open' : ''), onclick: flip},
      el('td', {}, el('div', {className: 'sitename'}, el('b', {textContent: g.label}), g.hint ? el('span', {className: 'muted', textContent: g.hint}) : null)),
      el('td', {textContent: String(g.count)}), el('td', {className: 'muted', textContent: g.claimed ? g.claimed + ' of ' + g.count : '—'}),
      el('td', {className: 'muted', textContent: g.neverRun ? 'never run' + (g.neverRun < g.count && g.oldest ? ' (+ ' + ago(g.oldest) + ')' : '') : g.oldest ? ago(g.oldest) : '—'}),
      el('td', {}, el('button', {className: 'chev', type: 'button', 'aria-expanded': String(on), 'aria-label': (on ? 'Collapse ' : 'Expand ') + g.label, textContent: '›', onclick: event => { event.stopPropagation(); flip(); }})));
    return on ? [main, el('tr', {className: 'more'}, el('td', {colSpan: 5}, causeDetail(g)))] : [main]; };
  const causeGroups = () => needsFixGroups(d.pool, d.scorecard, d.steps, d.latestBuild);
  const drawCauses = () => { causeBox.textContent = '';
    causeBox.append(el('div', {className: 'fixpanel'}, el('div', {className: 'fixhead'}, el('h2', {textContent: 'By cause · what to fix first'}),
      el('p', {className: 'muted', textContent: 'The rows that need a fix, grouped by their top cause, the biggest first. The rows listed first need a pool run, not a fix: their last run is older than the latest landed build' + (d.latestBuild ? ' (' + d.latestBuild + ')' : '') + ' or they never ran.'})),
      ...block('causes', 'Groups', 'Run first, then the biggest cause', causeGroups(), ['Cause', 'Rows', 'Claimed', 'Oldest run', 'Details'], causeRow, 'Nothing needs a fix', () => drawCauses(), [g => g.label.toLowerCase(), g => g.count, g => g.claimed, g => (g.oldest ? Date.parse(g.oldest) : null)]).filter(Boolean))); };
  const drawScore = () => { scoreBox.textContent = '';
    scoreBox.append(...block('score', 'Platforms', 'Real use against the tests', d.scorecard || [], ['Platform', 'Verdict', 'Of matched jobs', 'Real forms', 'Required filled', 'Pool sites', 'Reached the form'],
      s => el('tr', {}, el('td', {textContent: s.platform}), el('td', {}, el('span', {className: 'pill s-' + TONE[s.verdict], textContent: s.verdict})), el('td', {textContent: pct(s.matchShare)}),
        el('td', {className: 'muted', textContent: s.forms || '—'}), el('td', {className: 'muted', textContent: pct(s.filledShare)}), el('td', {className: 'muted', textContent: s.poolSites || 'none'}), el('td', {className: 'muted', textContent: pct(s.poolReached)})),
      'No platform seen yet', () => drawScore(), [s => s.platform, s => Object.keys(TONE).indexOf(s.verdict), s => s.matchShare, s => s.forms, s => s.filledShare, s => s.poolSites, s => s.poolReached]).filter(Boolean)); };
  app.append(el('section', {}, el('h2', {textContent: 'Platform scorecard · real use against the tests'}),
    el('p', {className: 'muted', textContent: 'Per platform: its share of the matched jobs and how well real forms are filled (the form-filling page), against the pool sites on it and how many reached the form. Verdicts, in the order to act: not in the pool; weak in both; blind spot (tests reach the form, real users do not fill it); test failing (real use is fine). Under 5 real forms is no evidence.'}), scoreBox)); drawScore();
${FIXED_SCRIPT}
  drawFix(); drawFixed(); drawCauses(); showTab();
  const caseBox = el('div'), CASE_GET = [c => c.name.toLowerCase(), c => c.rung, c => (c.ok ? 1 : 0), c => c.history.at(-1), c => c.day, c => c.since];
  const drawCases = () => { caseBox.textContent = ''; caseBox.append(el('table', {},
    el('tr', {}, ...heads('cases', ['Case', 'Rung guarded', 'Result', 'Last 10 runs', 'Last run', 'Since'], drawCases)),
    ...sortRows('cases', d.cases, CASE_GET).map(c => el('tr', {}, el('td', {textContent: c.name}), el('td', {className: 'muted', textContent: c.rung ?? '—'}), el('td', {}, c.ok ? el('span', {className: 'pill s-ready', textContent: 'passed'}) : el('span', {className: 'pill s-posting', textContent: 'failed'}),
      c.note ? el('div', {className: 'muted', textContent: c.note}) : null), el('td', {}, dots(c.history)), el('td', {className: 'muted', textContent: c.day + (c.version ? ' · ' + c.version : '')}),
      el('td', {className: 'muted', textContent: c.since}))))); };
  app.append(el('section', {}, el('h2', {textContent: 'Fixed-site replays · every fixed site, replayed'}), d.cases.length ? caseBox
    : el('p', {className: 'muted', textContent: 'No recorded-page run uploaded yet: cd desktop/e2e && npm run recorded'}))); if (d.cases.length) drawCases();
  app.append(el('section', {}, el('h2', {textContent: 'The pool · every smoke site'}), d.pool.length ? el('div', {}, filters, table, colorLegend)
    : el('p', {className: 'muted', textContent: 'No pool uploaded yet: cd desktop/e2e && npm run smoke'}))); if (d.pool.length) draw();
  // Fetch again every 15 s while the tab is visible and redraw the pool, so the spinner and the times follow a run without a reload.
  setInterval(() => { if (!document.hidden) fetch('?json').then(r => r.json()).then(fresh => { serverNow = Date.parse(fresh.now); d.pool = fresh.pool; d.next = fresh.next; d.scorecard = fresh.scorecard; d.fixed = fresh.fixed; d.cases = fresh.cases; d.latestBuild = fresh.latestBuild; draw(); drawFix(); drawFixed(); drawCauses(); showTab(); drawNext(); drawScore(); }).catch(() => {}); }, 15000);
}).catch(error => { document.getElementById('app').textContent = 'Could not load: ' + error.message; });
</script></main></body></html>`;
