// /admin/applying: are applications reliable? Layers 2 and 3 of the applying reliability spec (docs/superpowers/specs/2026-10-10-applying-reliability-layers.md):
// the recorded pages (each case, passed or failed, by run) and the nightly live smoke (each site: the step it reached, its last runs, regressions), plus the
// fleet's dropped boards (layer 4, src/digest.js). The owner's Mac uploads each run (POST here, the owner key; desktop/e2e/lib/applying-report.mjs): the
// site's host and fixed words only, never a posting's address or applicant data. Guard: test/applying.test.js.
import {viewer} from './auth.js';
import {digest} from './digest.js';
import {displayName, flowOf, platformLabel, SIGNATURE, signatureHost} from './platform.js';

export const STEPS = ['none', 'posting', 'account', 'code/bot', 'form', 'ready'];
const KINDS = ['smoke', 'recorded', 'pool'];
const DAY = /^\d{4}-\d\d-\d\d$/;
const text = (value, max) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const int = value => (Number.isInteger(value) && value >= 0 && value < 10000 ? value : null);
const hostOf = value => { const host = text(value, 120).toLowerCase(); return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? host : null; };

// -> {ok, stored} | {ok: false, error}. body: {kind, day, version, rows: [{name, start_host?, signature?} for 'pool'; {name, host?, reached?, filled?, left?, ok?, note?, regression?}]}
export async function ingest(db, body, now = new Date()) {
  const kind = KINDS.includes(body?.kind) ? body.kind : null, day = DAY.test(body?.day || '') ? body.day : null;
  const rows = Array.isArray(body?.rows) ? body.rows.slice(0, 200) : [];
  if (!kind || !day || !rows.length) return {ok: false, error: 'kind, day and rows are required'};
  const version = text(body.version, 20) || null, at = now.toISOString();
  let stored = 0;
  for (const row of rows) {
    const name = text(row?.name, 120);
    if (!name) continue;
    if (kind === 'pool') {   // a pool site: its start host and flow signature, fixed words only (a later row without them keeps what is known)
      const signature = SIGNATURE.test(text(row.signature, 200)) ? text(row.signature, 200) : null;
      await db.prepare(`INSERT INTO applying_pool (name, start_host, signature, at, version) VALUES (?, ?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET
        start_host = COALESCE(excluded.start_host, start_host), signature = COALESCE(excluded.signature, signature), at = excluded.at, version = excluded.version`)
        .bind(name, hostOf(row.start_host), signature, at, version).run();
      stored += 1; continue;
    }
    await db.prepare(`INSERT INTO applying_runs (kind, day, at, name, host, reached, filled, left_n, ok, note, regression, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(kind, day, at, name, kind === 'smoke' ? hostOf(row.host) : null, kind === 'smoke' && STEPS.includes(row.reached) ? row.reached : null,
        int(row.filled), int(row.left), kind === 'recorded' ? (row.ok ? 1 : 0) : null, text(row.note, 200) || null, row.regression ? 1 : 0, version).run();
    stored += 1;
  }
  return {ok: true, stored};
}

const all = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results || [];
const dayOf = date => date.toISOString().slice(0, 10);

export async function data(db, now = new Date()) {
  const since = dayOf(new Date(now.getTime() - 30 * 86400000)), tenDays = dayOf(new Date(now.getTime() - 9 * 86400000));
  const runs = await all(db, 'SELECT * FROM applying_runs WHERE day >= ? ORDER BY day, id', since);
  const byName = kind => runs.filter(run => run.kind === kind).reduce((out, run) => ((out[run.name] ||= []).push(run), out), {});
  const sites = Object.entries(byName('smoke')).map(([name, list]) => {
    const last = list.at(-1);
    return {name, host: last.host, reached: last.reached, filled: last.filled, left: last.left_n, day: last.day, version: last.version, note: last.note,
      regression: !!last.regression, history: list.slice(-10).map(run => run.reached || 'none')};
  }).sort((a, b) => Number(b.regression) - Number(a.regression) || STEPS.indexOf(a.reached) - STEPS.indexOf(b.reached));
  const cases = Object.entries(byName('recorded')).map(([name, list]) => {
    const last = list.at(-1);
    return {name, ok: !!last.ok, note: last.note, day: last.day, version: last.version, since: list[0].day, history: list.slice(-10).map(run => (run.ok ? 1 : 0))};
  }).sort((a, b) => Number(a.ok) - Number(b.ok) || a.name.localeCompare(b.name));
  const nights = Object.entries(runs.filter(run => run.kind === 'smoke').reduce((out, run) => {
    const counts = (out[run.day] ||= Object.fromEntries(STEPS.map(step => [step, 0])));
    counts[run.reached || 'none'] += 1;
    return out;
  }, {})).map(([day, counts]) => ({day, counts}));
  const pool = await poolRows(db, sites, runs);
  const live = sites.filter(site => !site.note);
  const dropped = await digest(db, now).then(d => d.boards.filter(board => board.dropped).map(board => ({board: board.board, earlier: board.earlierFilledShare, recent: board.recentFilledShare}))).catch(() => []);
  return {
    tiles: {
      cases: cases.length, casesFailing: cases.filter(item => !item.ok).length, casesLast: cases.map(item => item.day).sort().at(-1) || null,
      sites: sites.length, sitesRecent: sites.filter(site => site.day >= tenDays).length,
      reachedForm: live.length ? Math.round((100 * live.filter(site => ['form', 'ready'].includes(site.reached)).length) / live.length) : null,
      regressions: sites.filter(site => site.regression).length, gone: sites.filter(site => site.note).length, dropped: dropped.length},
    sites, pool, platforms: counts(pool, 'platform', 'flow'), flows: counts(pool, 'flow', 'platform').filter(item => item.name !== '—'), cases, nights, dropped, steps: STEPS, now: now.toISOString()};
}

// "Greenhouse: 4 sites, 3 flows": each group's size and how many different flows (or platforms) it holds.
const counts = (pool, key, other) => Object.entries(pool.reduce((out, item) => ((out[item[key] ?? '—'] ||= []).push(item), out), {}))
  .map(([name, list]) => ({name, sites: list.length, flows: new Set(list.map(item => item[other]).filter(Boolean)).size})).sort((a, b) => b.sites - a.sites || a.name.localeCompare(b.name));

// Every pool site (also one never run), joined with its smoke runs by name; a site that ran before it was uploaded as pool still shows, by its run host.
async function poolRows(db, sites, runs) {
  const uploaded = await all(db, 'SELECT * FROM applying_pool ORDER BY name'), known = new Map(uploaded.map(row => [row.name, row]));
  const names = [...new Set([...uploaded.map(row => row.name), ...sites.map(site => site.name)])];
  const byName = Object.fromEntries(sites.map(site => [site.name, site]));
  return names.map(name => {
    const row = known.get(name) || {}, site = byName[name], start = row.start_host || site?.host || '', end = signatureHost(row.signature) || '';
    const {flow, raw} = flowOf(row.signature, start);
    const step = row.signature?.match(/#([^#]+)$/)?.[1] || null, reached = site?.reached ?? step;
    return {name: displayName(name, start), platform: platformLabel(end, start), flow, raw, start, end, reached, day: site?.day ?? null, note: site?.note ?? null,
      regression: !!site?.regression, history: site?.history ?? (step ? [step] : [])};
  }).sort((a, b) => a.platform.localeCompare(b.platform) || a.name.localeCompare(b.name));
}

export async function view(request, env, now = new Date()) {
  if (!await viewer(request, env) || !env.STATS) return new Response('Not found', {status: 404});
  const noStore = {'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'};
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
*{box-sizing:border-box}.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:14px 0}
.tile{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px}.tile b{display:block;font-size:26px}.tile span{color:var(--muted);font-size:12px}
.tile.bad b{color:var(--red)}.tile.good b{color:var(--green)}section{margin:22px 0}table{width:100%;border-collapse:collapse}
th{text-align:left;color:var(--muted);font-weight:500;font-size:12px}td,th{padding:7px 8px 7px 0;border-bottom:1px solid var(--line);font-size:13px;vertical-align:top}
.pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600;color:#0b0d10}
.s-none{background:var(--muted)}.s-posting{background:var(--red)}.s-account{background:var(--amber)}.s-code\\/bot{background:var(--violet)}.s-form{background:var(--blue)}.s-ready{background:var(--green)}
.dots{white-space:nowrap}.dots i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:3px}
.chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:8px 0}.chip{background:var(--card);color:var(--text);border:1px solid var(--line);border-radius:999px;padding:3px 11px;font:inherit;font-size:12px;cursor:pointer}.chip.on{border-color:var(--amber);color:var(--amber)}
.flag{color:var(--red);font-weight:600}.muted{color:var(--muted)}.bars{display:flex;gap:6px;align-items:flex-end;height:110px;margin-top:8px}
.bar{display:flex;flex-direction:column-reverse;width:26px}.bar i{display:block}.bar small{color:var(--muted);font-size:10px;text-align:center}
</style></head><body><main>
<header><h1>🛡️ Applying tests</h1></header>
<p class="muted">Is applying reliable? <b>Recorded pages</b>: every site we fixed, replayed offline with the real extension on each push. <b>Nightly smoke</b>: real postings,
live, stopped before any account button or Submit, a rotating share each night. A site that reached less than its last run is a regression. Logs and screenshots stay on the Mac.</p>
<div id="app"><p class="muted">Loading…</p></div>
<script>
const el = (tag, props = {}, ...kids) => { const node = Object.assign(document.createElement(tag), props); node.append(...kids.filter(kid => kid != null)); return node; };
const pill = step => el('span', {className: 'pill s-' + step, textContent: step});
const color = step => getComputedStyle(document.querySelector('.s-' + CSS.escape(step)) || document.body).backgroundColor;
const tile = (value, label, tone) => el('div', {className: 'tile ' + (tone || '')}, el('b', {textContent: value ?? '–'}), el('span', {textContent: label}));
fetch('?json').then(r => r.json()).then(d => {
  const app = document.getElementById('app'); app.textContent = '';
  const legend = el('div', {hidden: true}, ...d.steps.map(step => pill(step))); app.append(legend);
  const t = d.tiles;
  app.append(el('div', {className: 'tiles'},
    tile(t.cases ? (t.cases - t.casesFailing) + ' / ' + t.cases : 0, 'recorded pages passing' + (t.casesLast ? ' · last ' + t.casesLast : ''), t.casesFailing ? 'bad' : t.cases ? 'good' : ''),
    tile(t.sites ? t.sitesRecent + ' / ' + t.sites : 0, 'smoke sites run in the last 10 nights'),
    tile(t.reachedForm == null ? '–' : t.reachedForm + '%', 'sites that reached the form', t.reachedForm >= 70 ? 'good' : ''),
    tile(t.regressions, 'regressions open' + (t.gone ? ' · ' + t.gone + ' posting(s) gone' : ''), t.regressions ? 'bad' : 'good'),
    tile(t.dropped, 'boards dropped in the fleet (layer 4)', t.dropped ? 'bad' : 'good')));
  const dots = list => el('span', {className: 'dots'}, ...list.map(step => el('i', {title: step, style: 'background:' + (typeof step === 'number' ? (step ? 'var(--green)' : 'var(--red)') : color(step))})));
  // The pool: every smoke site, also one never run; filters by platform and by flow combine.
  const chosen = {platform: null, flow: null}, table = el('div'), bars = {};
  const chips = (key, list, label) => { const bar = el('div', {className: 'chips'}); bars[key] = bar;
    bar.append(el('span', {className: 'muted', textContent: label}), ...list.map(item => { const chip = el('button', {className: 'chip', type: 'button', title: item.name,
      textContent: item.name + ' ' + item.sites + ' site' + (item.sites === 1 ? '' : 's') + (key === 'platform' ? ' · ' + item.flows + ' flow' + (item.flows === 1 ? '' : 's') : '')});
      chip.onclick = () => { chosen[key] = chosen[key] === item.name ? null : item.name; chip.parentNode.querySelectorAll('.chip').forEach(node => node.classList.toggle('on', node === chip && chosen[key] != null)); draw(); }; return chip; }));
    return bar; };
  const draw = () => { const rows = d.pool.filter(s => (!chosen.platform || s.platform === chosen.platform) && (!chosen.flow || s.flow === chosen.flow)); table.textContent = '';
    table.append(rows.length ? el('table', {},
      el('tr', {}, ...['Site', 'Platform', 'Flow it tests', 'Starts → ends on', 'Last reached', 'Last 10 runs'].map(h => el('th', {textContent: h}))),
      ...rows.map(s => el('tr', {}, el('td', {}, s.name, s.regression ? el('div', {className: 'flag', textContent: 'regression'}) : null, s.note ? el('div', {className: 'muted', textContent: s.note}) : null),
        el('td', {textContent: s.platform}), el('td', {title: s.raw || '', textContent: s.flow || '—'}),
        el('td', {className: 'muted', textContent: (s.start || '…') + (s.end && s.end !== s.start ? ' → ' + s.end : '')}),
        el('td', {}, s.reached ? pill(s.reached) : el('span', {className: 'muted', textContent: '—'}), s.day ? el('div', {className: 'muted', textContent: s.day}) : null),
        el('td', {}, s.history.length ? dots(s.history) : el('span', {className: 'muted', textContent: '—'}))))) : el('p', {className: 'muted', textContent: 'No site matches.'})); };
  app.append(el('section', {}, el('h2', {textContent: 'The pool · every smoke site'}), d.pool.length ? el('div', {}, chips('platform', d.platforms, 'Platform'), chips('flow', d.flows, 'Flow'), table)
    : el('p', {className: 'muted', textContent: 'No pool uploaded yet: cd desktop/e2e && npm run smoke'}))); if (d.pool.length) draw();
  app.append(el('section', {}, el('h2', {textContent: 'Recorded pages · every fixed site, replayed'}), d.cases.length ? el('table', {},
    el('tr', {}, ...['Case', 'Result', 'Last 10 runs', 'Last run', 'Since'].map(h => el('th', {textContent: h}))),
    ...d.cases.map(c => el('tr', {}, el('td', {textContent: c.name}), el('td', {}, c.ok ? el('span', {className: 'pill s-ready', textContent: 'passed'}) : el('span', {className: 'pill s-posting', textContent: 'failed'}),
      c.note ? el('div', {className: 'muted', textContent: c.note}) : null), el('td', {}, dots(c.history)), el('td', {className: 'muted', textContent: c.day + (c.version ? ' · ' + c.version : '')}),
      el('td', {className: 'muted', textContent: c.since}))))
    : el('p', {className: 'muted', textContent: 'No recorded-page run uploaded yet: cd desktop/e2e && npm run recorded'})));
  if (d.nights.length) {
    const most = Math.max(...d.nights.map(n => Object.values(n.counts).reduce((a, b) => a + b, 0)));
    app.append(el('section', {}, el('h2', {textContent: 'Nights · where each site got to'}), el('div', {className: 'bars'}, ...d.nights.map(n => el('div', {className: 'bar', title: n.day},
      el('small', {textContent: n.day.slice(5)}), ...d.steps.filter(step => n.counts[step]).map(step => el('i', {title: step + ': ' + n.counts[step], style: 'height:' + Math.round(90 * n.counts[step] / most) + 'px;background:' + color(step)})))))));
  }
}).catch(error => { document.getElementById('app').textContent = 'Could not load: ' + error.message; });
</script></main></body></html>`;
