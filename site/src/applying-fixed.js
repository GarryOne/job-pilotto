// /admin/applying's Fixed tab (owner, 11 Oct 2026: "a view to see what was fixed"): the fix ledger and the claims the owner's Mac uploads as snapshots
// (desktop/e2e/lib/fix-ledger.mjs: git trailers "Pool-row:", "Rung:", "Fixture:" plus desktop/e2e/pool-fixes.json; tools/claim-shape.mjs list), joined at view
// time with the smoke runs already uploaded: a fix is "landed" until an uploaded run after it clears the row ("confirmed"), "back" when a later run lists it again.
// Fixed values only: a site name without an address or query, a short hash, a version, a rung, guard ids. Owns FIXED_SCRIPT, the tab's client code, which
// src/applying.js puts inside its page (it uses that page's el, heads/block, dots, ago). Guard: test/applying-fixed.test.js.

export const FIX_KINDS = ['fixes', 'claims'];
const text = (value, max) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const siteOf = value => { const name = text(value, 120); return name && !/[?=@]|:\/\/|https?:/i.test(name) ? name : null; };
const isoOf = value => { const time = Date.parse(text(value, 40)); return Number.isFinite(time) ? new Date(time).toISOString() : null; };
const HASH = /^[0-9a-f]{7,40}$/, VERSION = /^\d+(\.\d+){1,3}$/, GUARD = /^(recorded|fixture):[a-z0-9][a-z0-9-]{0,79}$/;
const RUNG = /^(?:[0-6]|router|judges)(?:\s*,\s*(?:[0-6]|router|judges))*$/;
const all = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results || [];

// A snapshot replaces the last one ("fixes": the whole ledger; "claims": every claim held now, an empty list releases them all). -> {ok, stored}
export async function ingestFixes(db, body, now = new Date()) {
  const rows = Array.isArray(body?.rows) ? body.rows.slice(0, 500) : null;
  if (!rows) return {ok: false, error: 'rows are required'};
  const at = now.toISOString();
  let stored = 0;
  if (body.kind === 'claims') {
    await db.prepare('DELETE FROM applying_claims').bind().run();
    for (const row of rows) {
      const site = siteOf(row?.name), since = isoOf(row?.since);
      if (!site || !since) continue;
      await db.prepare('INSERT OR REPLACE INTO applying_claims (site, since) VALUES (?, ?)').bind(site, since).run();
      stored += 1;
    }
  } else {
    await db.prepare('DELETE FROM applying_fixes').bind().run();
    for (const row of rows) {
      const site = siteOf(row?.site), hash = text(row?.commit, 40).toLowerCase(), landed = isoOf(row?.landedAt);
      if (!site || !HASH.test(hash) || !landed) continue;
      const version = VERSION.test(text(row.extensionVersion, 20)) ? text(row.extensionVersion, 20) : null, rung = RUNG.test(text(row.rung, 40)) ? text(row.rung, 40) : null;
      const guard = (Array.isArray(row.guard) ? row.guard : []).map(item => text(item, 90)).filter(item => GUARD.test(item)).slice(0, 10);
      await db.prepare('INSERT OR REPLACE INTO applying_fixes (site, commit_hash, version, rung, landed_at, guard, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(site, hash, version, rung, landed, JSON.stringify(guard), at).run();
      stored += 1;
    }
  }
  await db.prepare('INSERT INTO applying_snapshots (kind, at) VALUES (?, ?) ON CONFLICT(kind) DO UPDATE SET at = excluded.at').bind(body.kind, at).run();
  return {ok: true, stored};
}

const shareOf = run => (Number.isInteger(run.filled) && Number.isInteger(run.left) && run.filled + run.left > 0 ? Math.round((100 * run.filled) / (run.filled + run.left)) : null);

// One fixed pool row's status from its runs ({at, needsFix: true | false | null for a gone posting}) and its latest landing.
export function statusOf(runs, landedAt) {
  const landed = Date.parse(landedAt), after = runs.filter(run => Date.parse(run.at) > landed && run.needsFix != null);
  const cleared = after.findIndex(run => run.needsFix === false);
  const filledBefore = runs.filter(run => Date.parse(run.at) <= landed).slice(-3).map(shareOf), filledAfter = after.slice(-3).map(shareOf);
  if (cleared < 0) return {status: 'landed', failingRuns: after.length, filledBefore, filledAfter};
  return {status: after.at(-1).needsFix ? 'back' : 'confirmed', confirmedAt: after[cleared].at, failingRuns: 0, filledBefore, filledAfter};
}

// -> {day, rows, inProgress, claimsAt, fixesAt}. pool: the page's pool rows (name as shown, shape, platform, runs); cases: the recorded cases.
// Marks each pool row with `back` and `claimed` for the Needs a fix tab.
export async function fixedData(db, pool, cases, now = new Date()) {
  const fixes = await all(db, 'SELECT * FROM applying_fixes ORDER BY landed_at');
  const snapshots = Object.fromEntries((await all(db, 'SELECT kind, at FROM applying_snapshots')).map(row => [row.kind, row.at]));
  const claims = await all(db, 'SELECT site, since FROM applying_claims ORDER BY since');
  const bySite = fixes.reduce((out, fix) => ((out[fix.site] ||= []).push(fix), out), {}), caseByName = new Map(cases.map(item => [item.name, item]));
  const rows = Object.entries(bySite).map(([site, list]) => {
    const last = list.at(-1), item = pool.find(row => row.name === site || row.shape === site);
    const guard = [...new Set(list.flatMap(fix => JSON.parse(fix.guard || '[]')))];
    const linked = guard.filter(id => id.startsWith('recorded:')).map(id => caseByName.get(id.slice(9))).filter(Boolean);
    const landed = Date.parse(last.landed_at), runs = (item?.runs || []).slice(-10).map(run => ({day: run.day, at: run.at, reached: run.reached, share: shareOf(run), needsFix: run.needsFix, after: Date.parse(run.at) > landed}));
    return {site, platform: item?.platform ?? '—', host: item?.start || '', commit: last.commit_hash, commits: list.map(fix => fix.commit_hash), extensionVersion: last.version, rung: last.rung, landedAt: last.landed_at,
      fixes: list.map(fix => ({commit: fix.commit_hash, extensionVersion: fix.version, rung: fix.rung, landedAt: fix.landed_at})), runs,
      ...statusOf(item?.runs || [], last.landed_at), guard, cases: linked.map(found => ({name: found.name, ok: found.ok, history: found.history, day: found.day}))};
  }).sort((a, b) => b.landedAt.localeCompare(a.landedAt));
  const claimed = new Map(claims.map(row => [row.site, row.since])), back = new Set(rows.filter(row => row.status === 'back').map(row => row.site));
  for (const item of pool) { item.claimed = claimed.get(item.shape) ?? claimed.get(item.name) ?? null; item.back = back.has(item.shape) || back.has(item.name); }
  return {day: now.toISOString().slice(0, 10), rows, inProgress: claims.map(row => ({site: row.site, since: row.since})), claimsAt: snapshots.claims ?? null, fixesAt: snapshots.fixes ?? null};
}

export const FIXED_CSS = `
.tabs{display:flex;gap:6px;margin:18px 0 0;padding:0 0 0 12px;border-bottom:1px solid var(--line)}
.tabs a{position:relative;display:inline-block;margin-bottom:-1px;padding:10px 18px;border:1px solid var(--line);border-bottom:0;border-radius:10px 10px 0 0;background:var(--bg);color:var(--muted);font-size:14px;text-decoration:none}
.tabs a:hover{color:var(--text)}.tabs a:focus-visible{outline:2px solid var(--amber);outline-offset:-2px}.tabs a.on{background:var(--card);color:var(--text);font-weight:600;border-bottom:1px solid var(--card);box-shadow:inset 0 2px 0 var(--amber)}
.tabs ~ section.fix,.tabs ~ section.fixed,.tabs ~ section.bycause{margin-top:0;padding-top:0;border-top:0}.tabs ~ section .fixpanel{border-top:0;border-radius:0 0 12px 12px}
.fixpanel .filters{margin:0;padding:12px 16px;background:none;border:0;border-top:1px solid var(--line);border-radius:0}.fixpanel td,.fixpanel th{padding:12px 16px}.fixpanel th{border-top:1px solid var(--line)}
.fixpanel{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}.fixhead{padding:16px}.fixhead h2{margin:0 0 4px;font-size:18px}.fixhead p{margin:0 0 8px}
.how{font-size:13px}.how summary{cursor:pointer;color:var(--muted)}.how summary:hover{color:var(--text)}.how dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 14px;margin:10px 0 0}.how dt{font-weight:600}.how dd{margin:0;color:var(--muted)}
.fixbar,.fixfoot{display:flex;flex-wrap:wrap;gap:8px 16px;justify-content:space-between;align-items:center;padding:12px 16px;border-top:1px solid var(--line);font-size:13px}.fixfoot .pager{margin:0}
.fixtable td,.fixtable th{padding:12px 16px;white-space:normal!important;overflow-wrap:break-word;vertical-align:middle}.fixtable .pill,.hash{white-space:nowrap}.fixtable th{border-top:1px solid var(--line)}
.fixtable tr.site{cursor:pointer}.fixtable tr.site:hover td,.fixtable tr.site.open td{background:rgba(255,255,255,.03)}.fixtable tr.more td{padding:0 16px 12px}.fixtable td:last-child,.fixtable th:last-child{text-align:right;width:84px}
.fixtable .sitename b{display:block;font-size:14px}.hash{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:2px 7px}
.fixguard{margin:0;padding:0;list-style:none}.fixguard li{margin:4px 0;overflow-wrap:anywhere}.fixtable .detail{text-align:left}@media (max-width:900px){.fixtable .c-fill,.fixtable .c-fix{display:none}.fixtable td,.fixtable th{padding:12px 10px}.fixtable .pill{white-space:normal;border-radius:12px}.fixtable td:first-child,.fixtable th:first-child{padding-left:16px}.fixtable td:last-child,.fixtable th:last-child{width:48px;padding-right:16px}}.fixtable .detail h4{margin:14px 0 6px}.fixtable .detail>div>:first-child,.fixtable .detail>div>:first-child h4{margin-top:0}
`;

// The tab's client code, inside the page's fetch callback (needs el, heads, sortRows, dots, ago, STAGE, d, fixBox, fixedBox, causeBox, tabs, needsFixOrder, causeGroups). Plain quotes only: it sits in a template literal.
export const FIXED_SCRIPT = `
  // The Fixed tab (owner mockup, 11 Oct 2026; src/applying-fixed.js): one charcoal panel, five columns, the guard names, replay results and run history in a row expander.
  const FIX_WORD = {landed: 'Awaiting verification', failing: 'Still failing', confirmed: 'Confirmed', back: 'Regressed'};
  const FIX_TONE = {landed: 'account', failing: 'posting', confirmed: 'ready', back: 'posting'}, FIX_ORDER = ['back', 'failing', 'landed', 'confirmed'];
  const fixKind = r => (r.status === 'landed' && r.failingRuns ? 'failing' : r.status);
  const fixReason = r => ({landed: 'No confirming run yet', failing: r.failingRuns + (r.failingRuns === 1 ? ' run' : ' runs') + ' since fix', confirmed: r.confirmedAt ? 'Cleared ' + ago(r.confirmedAt) : 'Cleared',
    back: 'Listed again after confirmation'})[fixKind(r)];
  const fixShort = name => { const cut = name.indexOf(' ('); let t = cut > 0 ? name.slice(0, cut) : name; if (t.length > 44) t = t.slice(0, Math.max(20, t.lastIndexOf(' ', 44))) + '…'; return t; };
  const fixDate = iso => new Date(iso).toUTCString().slice(5, 11);
  const fixShare = list => { const v = (list || []).filter(value => value != null); return v.length ? v.at(-1) + '%' : '—'; };
  const fixFilled = r => ((fixShare(r.filledBefore) === '—' && fixShare(r.filledAfter) === '—') ? '—' : fixShare(r.filledBefore) + ' → ' + fixShare(r.filledAfter));
  const fixedList = () => d.fixed.rows;
  const fixOpen = new Set(), fixPage = {n: 0}, FIX_PER = NEXT_PER;
  const fixDetail = r => el('div', {className: 'detail'},
    el('div', {}, fixShort(r.site) !== r.site ? el('div', {}, el('h4', {textContent: 'Scenario'}), el('div', {textContent: r.site})) : null,
      el('div', {className: 'narrow'}, el('h4', {textContent: 'Filled before → after'}), el('div', {textContent: fixFilled(r)})),
      el('h4', {textContent: 'Fix'}), r.fixes.length ? el('dl', {}, ...r.fixes.flatMap(f => [el('dt', {}, el('code', {className: 'hash', textContent: f.commit})), el('dd', {className: 'muted', textContent: [f.extensionVersion, fixDate(f.landedAt), 'rung ' + (f.rung ?? '?')].filter(Boolean).join(' · ')})])) : el('div', {className: 'muted', textContent: 'No fix names this replay'}),
      el('h4', {textContent: 'Guard · replay results'}), el('ul', {className: 'fixguard'}, ...r.guard.map(id => { const found = (r.cases || []).find(c => 'recorded:' + c.name === id);
        return el('li', {}, id.replace(':', ' '), found ? el('span', {}, ' ', dots(found.history), ' ', found.ok ? 'passed' : 'failed', found.day ? ' · last ' + found.day : '') : el('span', {className: 'muted', textContent: id.startsWith('fixture:') ? ' (ladder fixture)' : ' (not replayed in the last uploaded run)'})); }))),
    el('div', {}, el('h4', {textContent: 'Runs · filled' + (r.runs.length ? '' : '')}), r.runs.length ? el('ul', {className: 'fixguard'}, ...r.runs.map(run => el('li', {}, run.day + ' · ' + (STAGE[run.reached] || run.reached || 'Nothing reached') + (run.share != null ? ' · ' + run.share + '% filled' : ''), run.after ? el('span', {className: 'muted', textContent: ' · after the fix'}) : null)))
      : el('div', {className: 'muted', textContent: 'No smoke run uploaded for this site.'})));
  const fixRows = r => { const on = fixOpen.has(r.site), kind = fixKind(r), flip = () => { toggleOpen(fixOpen, r.site); drawFixed(); };
    const main = el('tr', {className: 'site' + (on ? ' open' : ''), onclick: flip},
      el('td', {}, el('div', {className: 'sitename'}, el('b', {textContent: fixShort(r.site)}), el('span', {className: 'muted', textContent: r.platform + (r.host ? ' (' + r.host + ')' : '')}))),
      el('td', {}, el('span', {className: 'pill s-' + FIX_TONE[kind], textContent: FIX_WORD[kind]}), el('span', {className: 'stack muted', textContent: fixReason(r)})),
      el('td', {className: 'c-fill', textContent: fixFilled(r)}),
      el('td', {className: 'c-fix'}, r.commit ? el('code', {className: 'hash', title: r.fixes.map(f => f.commit + ' ' + (f.extensionVersion || '')).join(', '), textContent: r.commit + (r.commits.length > 1 ? ' +' + (r.commits.length - 1) : '')}) : '—', r.commit ? el('span', {className: 'stack muted', textContent: fixDate(r.landedAt) + ' · rung ' + (r.rung ?? '?')}) : null),
      el('td', {}, el('button', {className: 'chev', type: 'button', 'aria-expanded': String(on), 'aria-label': (on ? 'Collapse ' : 'Expand ') + r.site, textContent: '›', onclick: event => { event.stopPropagation(); flip(); }})));
    return on ? [main, el('tr', {className: 'more'}, el('td', {colSpan: 5}, fixDetail(r)))] : [main]; };
  const FIX_GET = [r => r.site.toLowerCase(), r => FIX_ORDER.indexOf(fixKind(r)), r => (fixShares0(r) ?? null), r => r.landedAt, r => r.guard.length];
  const fixShares0 = r => ((r.filledAfter || []).filter(value => value != null).at(-1));
  const HOW = [['Awaiting verification', 'The fix landed and no uploaded run since then has cleared the site: none yet, or the runs say nothing.'], ['Still failing', 'Runs uploaded after the fix still list the site under Needs a fix; the count is those runs.'],
    ['Confirmed', 'An uploaded run after the fix no longer lists the site under Needs a fix. It does not say how much more was filled: read the filled column for that.'], ['Regressed', 'It was confirmed, then a later run lists the site again (it is on Needs a fix too).'],
    ['Filled before → after', 'The share of fields filled in the last run before the fix and in the last run after it; the expander lists every run.'],
    ['Source', 'Git trailers (Pool-row, Rung, Fixture) and the uploaded smoke runs, as of ' + (d.fixed.fixesAt ? ago(d.fixed.fixesAt) : 'no upload yet') + '.']];
  const drawFixed = () => { fixedBox.textContent = '';
    const all = fixedList().sort((a, b) => FIX_ORDER.indexOf(fixKind(a)) - FIX_ORDER.indexOf(fixKind(b)) || String(b.landedAt || '').localeCompare(String(a.landedAt || ''))), rows = sortRows('fixed', all, FIX_GET);
    const pages = Math.max(1, Math.ceil(rows.length / FIX_PER)); fixPage.n = Math.min(fixPage.n, pages - 1); const from = fixPage.n * FIX_PER, shown = rows.slice(from, from + FIX_PER), go = step => () => { fixPage.n += step; drawFixed(); };
    fixedBox.append(el('div', {className: 'fixpanel'},
      el('div', {className: 'fixhead'}, el('h2', {textContent: 'Fix verification'}), el('p', {className: 'muted', textContent: 'Every landed fix is "Awaiting verification" until an uploaded run clears it.'}),
        el('details', {className: 'how'}, el('summary', {textContent: 'How verification works'}), el('dl', {}, ...HOW.flatMap(([word, text]) => [el('dt', {textContent: word}), el('dd', {textContent: text})])))),
      el('div', {className: 'fixbar'}, el('span', {className: 'muted', textContent: 'Regressed first, then newest'}), el('span', {className: 'muted', textContent: all.length + (all.length === 1 ? ' site' : ' sites') + ' with a landed fix'})),
      rows.length ? el('table', {className: 'fixtable'}, el('tr', {}, ...heads('fixed', ['Site / platform', 'Verification', 'Filled before → after', 'Fix', 'Details'], () => { fixPage.n = 0; drawFixed(); }).map((th, at) => Object.assign(th, {className: th.className + (at === 2 ? ' c-fill' : at === 3 ? ' c-fix' : '')}))), ...shown.flatMap(fixRows)) : el('p', {className: 'muted', textContent: 'No fix landed yet'}),
      el('div', {className: 'fixfoot'}, el('span', {className: 'muted', textContent: rows.length ? 'Showing ' + (from + 1) + '–' + (from + shown.length) + ' of ' + rows.length + ' fixes' : '0 fixes'}),
        pages > 1 ? el('div', {className: 'pager'}, el('button', {className: 'chip', type: 'button', textContent: '← Previous', disabled: fixPage.n === 0, onclick: go(-1)}), el('button', {className: 'chip', type: 'button', textContent: 'Next →', disabled: fixPage.n >= pages - 1, onclick: go(1)})) : null))); };
  const showTab = () => { const hash = typeof location !== 'undefined' ? location.hash : '', which = hash === '#fixed' ? 'fixed' : hash === '#by-cause' ? 'cause' : 'needs'; fixBox.hidden = which !== 'needs'; fixedBox.hidden = which !== 'fixed'; causeBox.hidden = which !== 'cause';
    const tab = (id, name, text, title) => el('a', {href: '#' + id, role: 'tab', 'aria-selected': String(which === name), className: which === name ? 'on' : '', title: title || '', textContent: text});
    tabs.textContent = ''; tabs.append(tab('needs-fix', 'needs', 'Needs a fix · ' + needsFixOrder(d.pool, d.scorecard, d.steps).rows.length), tab('fixed', 'fixed', 'Fixed · ' + d.fixed.rows.length, 'Sites with a landed fix. The recorded replays are in the Fixed-site replays table below.'),
      tab('by-cause', 'cause', 'By cause · ' + causeGroups().length, 'The Needs a fix rows grouped by top cause, and the rows that need a pool run first')); };
  if (typeof window !== 'undefined') window.addEventListener('hashchange', showTab);
`;
