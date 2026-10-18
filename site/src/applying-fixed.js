// /admin/lab-form-filling's Fixed tab (owner, 11 Oct 2026: "a view to see what was fixed"): the fix ledger and the claims the owner's Mac uploads as snapshots
// (desktop/e2e/lib/fix-ledger.mjs: git trailers "Pool-row:", "Rung:", "Fixture:" plus desktop/e2e/pool-fixes.json; tools/claim-shape.mjs list), joined at view
// time with the smoke runs already uploaded: a fix is "landed" until an uploaded run after it clears the row ("confirmed"), "back" when a later run lists it again.
// Fixed values only: a site name without an address or query, a short hash, a version, a rung, guard ids. Owns FIXED_SCRIPT, the tab's client code, which
// src/applying.js puts inside its page (it uses that page's el, heads/block, dots, ago). Guard: test/applying-fixed.test.js.

import {readVerify, verifyFor} from './applying-verify.js';

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
  } else {   // the whole ledger, written as a diff: only rows that are new or changed, and only rows no longer listed are deleted (the D1 write budget)
    const old = new Map((await all(db, 'SELECT site, commit_hash, version, rung, landed_at, guard, subject FROM applying_fixes')).map(row => [row.site + '\n' + row.commit_hash, row])), keep = new Set();
    for (const row of rows) {
      const site = siteOf(row?.site), hash = text(row?.commit, 40).toLowerCase(), landed = isoOf(row?.landedAt);
      if (!site || !HASH.test(hash) || !landed) continue;
      const version = VERSION.test(text(row.extensionVersion, 20)) ? text(row.extensionVersion, 20) : null, rung = RUNG.test(text(row.rung, 40)) ? text(row.rung, 40) : null;
      const subject = (() => { const line = text(row.subject, 120); return line && !/[?=@]|:\/\/|https?:/i.test(line) ? line : null; })();
      const guard = JSON.stringify((Array.isArray(row.guard) ? row.guard : []).map(item => text(item, 90)).filter(item => GUARD.test(item)).slice(0, 10));
      keep.add(site + '\n' + hash); stored += 1;
      const was = old.get(site + '\n' + hash);
      if (was && was.version === version && was.rung === rung && was.landed_at === landed && was.guard === guard && was.subject === subject) continue;
      await db.prepare('INSERT OR REPLACE INTO applying_fixes (site, commit_hash, version, rung, landed_at, guard, subject, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(site, hash, version, rung, landed, guard, subject, at).run();
    }
    for (const [key, row] of old) if (!keep.has(key)) await db.prepare('DELETE FROM applying_fixes WHERE site = ? AND commit_hash = ?').bind(row.site, row.commit_hash).run();
  }
  await db.prepare('INSERT INTO applying_snapshots (kind, at) VALUES (?, ?) ON CONFLICT(kind) DO UPDATE SET at = excluded.at').bind(body.kind, at).run();
  return {ok: true, stored};
}

// A held run (an account-first stop, applying.js isHold) has no filled share: its counts are the sign-up page's, not the application's.
const shareOf = run => (!run.hold && Number.isInteger(run.filled) && Number.isInteger(run.left) && run.filled + run.left > 0 ? Math.round((100 * run.filled) / (run.filled + run.left)) : null);

// One fixed pool row's status from its runs ({at, needsFix: true | false | null for a gone posting}) and its latest landing.
// Confirmed needs TWO clean runs after the landing (owner, 11 Oct 2026: Hornbach's one clean run was the AI naming the working link by luck, then it was back);
// one clean run is "landed" with cleanRuns 1. Back = confirmed, then a later run lists the row again.
// A hold (run.cleanHold: every on-purpose hold but the eligibility stop, applying-status.js isCleanHold) is the site's accepted end, so it is a clean run (owner, 11 Oct 2026: "hold = clean", 14 Oct 2026: every hold);
// heldRuns counts them. An eligibility stop is about the posting, not the site: it stays neither (it once made Ashby "Regressed": a stop before any field, read as a clean run, 7e38ed8).
export function statusOf(runs, landedAt) {
  const landed = Date.parse(landedAt);
  const after = runs.map(run => (run.cleanHold ? {...run, needsFix: false} : run)).filter(run => Date.parse(run.at) > landed && run.needsFix != null).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const clean = after.filter(run => run.needsFix === false), heldRuns = clean.filter(run => run.cleanHold).length;
  // Failing is judged on the row's NEWEST run only (owner, 15 Oct 2026: the same rule as the Needs a fix list, applying.js runNeedsFix): an older failing run no longer makes a fix "Still failing".
  const newest = runs.map(run => (run.cleanHold ? {...run, needsFix: false} : run)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).at(-1), failing = Boolean(newest && Date.parse(newest.at) > landed && newest.needsFix === true);
  const filledBefore = runs.filter(run => Date.parse(run.at) <= landed).slice(-3).map(shareOf), filledAfter = after.slice(-3).map(shareOf);
  if (clean.length < 2) return {status: 'landed', failing, failingRuns: after.length - clean.length, cleanRuns: after.at(-1)?.needsFix === false ? clean.length : 0, heldRuns, filledBefore, filledAfter};
  return {status: failing ? 'back' : 'confirmed', failing, confirmedAt: clean[1].at, failingRuns: 0, cleanRuns: clean.length, heldRuns, filledBefore, filledAfter};
}

// A fix's (or a claim's) site as its pool row is named: itself when a row has that shape or name, else the one row whose capture-folder slug it is (desktop/e2e/lib/replay-candidate.mjs slug;
// e5e68c7's "Pool-row: ashby-form-in-an-embedded-app" made Ashby a second Fixed row, 11 Oct 2026). Two rows with that slug, or none: kept as written.
const slugOf = value => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
export function rowName(site, pool) {
  if (pool.some(row => row.shape === site || row.name === site)) return site;
  const matches = pool.filter(row => slugOf(row.shape) === site);
  return matches.length === 1 ? matches[0].shape : site;
}

// -> {day, rows, inProgress, claimsAt, fixesAt}. pool: the page's pool rows (name as shown, shape, platform, runs); cases: the recorded cases.
// Marks each pool row with `back` and `claimed` for the Needs a fix tab.
export async function fixedData(db, pool, cases, now = new Date()) {
  const fixes = await all(db, 'SELECT * FROM applying_fixes ORDER BY landed_at');
  const snapshots = Object.fromEntries((await all(db, 'SELECT kind, at FROM applying_snapshots')).map(row => [row.kind, row.at]));
  const claims = await all(db, 'SELECT site, since FROM applying_claims ORDER BY since');
  const offline = await readVerify(db);   // the offline replays' verdicts (src/applying-verify.js)
  const bySite = fixes.reduce((out, fix) => ((out[rowName(fix.site, pool)] ||= []).push(fix), out), {}), caseByName = new Map(cases.map(item => [item.name, item]));
  const rows = Object.entries(bySite).map(([site, list]) => {
    const last = list.at(-1), item = pool.find(row => row.name === site || row.shape === site);
    const guard = [...new Set(list.flatMap(fix => JSON.parse(fix.guard || '[]')))];
    const linked = guard.filter(id => id.startsWith('recorded:')).map(id => caseByName.get(id.slice(9))).filter(Boolean);
    const landed = Date.parse(last.landed_at), runs = (item?.runs || []).slice(-10).map(run => ({day: run.day, at: run.at, reached: run.reached, share: shareOf(run), hold: !!run.hold, needsFix: run.needsFix, after: Date.parse(run.at) > landed}));
    return {site, platform: item?.platform ?? '—', host: item?.start || '', commit: last.commit_hash, commits: list.map(fix => fix.commit_hash), extensionVersion: last.version, rung: last.rung, landedAt: last.landed_at,
      fixes: list.map(fix => ({commit: fix.commit_hash, extensionVersion: fix.version, rung: fix.rung, landedAt: fix.landed_at})), runs,
      offline: verifyFor(offline, 'fixed', site), ...statusOf(item?.runs || [], last.landed_at), guard, cases: linked.map(found => ({name: found.name, ok: found.ok, history: found.history, day: found.day}))};
  }).sort((a, b) => b.landedAt.localeCompare(a.landedAt));
  const claimed = new Map(claims.map(row => [rowName(row.site, pool), row.since])), back = new Set(rows.filter(row => row.status === 'back').map(row => row.site)), didntHold = new Map(rows.filter(row => row.failing).map(row => [row.site, row.commit]));
  for (const item of pool) { item.offline = verifyFor(offline, 'regression', item.shape) || verifyFor(offline, 'regression', item.name); item.claimed = claimed.get(item.shape) ?? claimed.get(item.name) ?? null; item.back = back.has(item.shape) || back.has(item.name); item.didntHold = didntHold.get(item.shape) ?? didntHold.get(item.name) ?? null; }
  return {day: now.toISOString().slice(0, 10), rows, inProgress: claims.map(row => ({site: rowName(row.site, pool), since: row.since})), claimsAt: snapshots.claims ?? null, fixesAt: snapshots.fixes ?? null};
}

export const FIXED_CSS = `
.tabs{display:flex;gap:6px;margin:18px 0 0;padding:0 0 0 12px;border-bottom:1px solid var(--line)}
.tabs a{position:relative;display:inline-block;margin-bottom:-1px;padding:10px 18px;border:1px solid var(--line);border-bottom:0;border-radius:10px 10px 0 0;background:var(--bg);color:var(--muted);font-size:14px;text-decoration:none}
.tabs a:hover{color:var(--text)}.tabs a:focus-visible{outline:2px solid var(--amber);outline-offset:-2px}.tabs a.on{background:var(--card);color:var(--text);font-weight:600;border-bottom:1px solid var(--card);box-shadow:inset 0 2px 0 var(--amber)}
.tabs ~ section.fix,.tabs ~ section.leftempty,.tabs ~ section.bycause{margin-top:0;padding-top:0;border-top:0}.tabs ~ section .fixpanel{border-top:0;border-radius:0 0 12px 12px}
.fixpanel .filters{margin:0;padding:12px 16px;background:none;border:0;border-top:1px solid var(--line);border-radius:0}.fixpanel td,.fixpanel th{padding:12px 16px}.fixpanel th{border-top:1px solid var(--line)}
.fixpanel{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}.fixhead{padding:16px}.fixhead h2{margin:0 0 4px;font-size:18px}.fixhead p{margin:0 0 8px}
.how{font-size:13px}.how summary{cursor:pointer;color:var(--muted)}.how summary:hover{color:var(--text)}.how dl{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:8px 14px;align-items:center;margin:12px 0 0}.how .howsrc{margin:10px 0 0;font-size:12px}.how dt{font-weight:600}.how dd{margin:0;color:var(--muted)}
.fixbar,.fixfoot{display:flex;flex-wrap:wrap;gap:8px 16px;justify-content:space-between;align-items:center;padding:12px 16px;border-top:1px solid var(--line);font-size:13px}.fixfoot .pager{margin:0}
.fixtable td,.fixtable th{padding:12px 16px;white-space:normal!important;overflow-wrap:break-word;vertical-align:middle}.fixtable .pill,.hash{white-space:nowrap}.fixtable th{border-top:1px solid var(--line)}
.fixtable tr.site{cursor:pointer}.fixtable tr.site:hover td,.fixtable tr.site.open td{background:rgba(255,255,255,.03)}.fixtable tr.more td{padding:0 16px 12px}.fixtable td:last-child,.fixtable th:last-child{text-align:right;width:84px}
.fixtable .sitename b{display:block;font-size:14px}.hash{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:2px 7px}
.fixguard{margin:0;padding:0;list-style:none}.fixguard li{margin:4px 0;overflow-wrap:anywhere}.fixtable .detail{text-align:left}@media (max-width:900px){.fixtable .c-fill,.fixtable .c-fix{display:none}.fixtable td,.fixtable th{padding:12px 10px}.fixtable .pill{white-space:normal;border-radius:12px}.fixtable td:first-child,.fixtable th:first-child{padding-left:16px}.fixtable td:last-child,.fixtable th:last-child{width:48px;padding-right:16px}}.fixtable .detail h4{margin:14px 0 6px}.fixtable .detail>div>:first-child,.fixtable .detail>div>:first-child h4{margin-top:0}
`;

// The tab's client code, inside the page's fetch callback (needs el, heads, sortRows, dots, ago, STAGE, d, fixHash, fixBox, emptyBox, fixedBox, causeBox, tabs, needsFixOrder, causeGroups). Plain quotes only: it sits in a template literal.
export const FIXED_SCRIPT = `
  // The Fixed tab (owner mockup, 11 Oct 2026; src/applying-fixed.js): one charcoal panel, five columns, the guard names, replay results and run history in a row expander.
  const FIX_WORD = {landed: 'Awaiting verification', failing: 'Still failing', better: 'Better, not there yet', confirmed: 'Confirmed', back: 'Regressed'};
  const FAILED = ['back', 'failing', 'better'];   // a fix that did not hold: its row is on Needs a fix, not here (owner, 15 Oct 2026)
  const FIX_TONE = {landed: 'account', failing: 'posting', better: 'form', confirmed: 'ready', back: 'posting'}, FIX_ORDER = ['landed', 'confirmed', 'back', 'failing', 'better'];
  const lastShare = list => (list || []).filter(value => value != null).at(-1);
  const fixKind = r => (r.status === 'landed' && r.failing ? (lastShare(r.filledAfter) > lastShare(r.filledBefore) ? 'better' : 'failing') : r.status);   // a share that rose is better, not yet there (a missing share compares false)
  // The offline replay's own word (src/applying-verify.js; owner, 14 Oct 2026): a fix is confirmed offline on a recording, never by a live run. Plain quotes only.
  const OFFLINE_WORD = {confirmed: 'Confirmed offline', holds: 'Holds offline', notbetter: 'Not better offline', live: 'Needs a recording', ours: 'Our build', site: 'Site changed'};
  const offlineLine = r => (r.offline ? (OFFLINE_WORD[r.offline.verdict] || r.offline.verdict) + ' ' + ago(r.offline.at) + (r.offline.why ? ' - ' + r.offline.why : '') : 'No offline replay yet');
  const fixReason = r => ({landed: r.cleanRuns ? 'One clean run: one more confirms' : 'No confirming run yet', failing: r.failingRuns + (r.failingRuns === 1 ? ' run' : ' runs') + ' since fix', better: r.failingRuns + (r.failingRuns === 1 ? ' run' : ' runs') + ' since fix · filled ' + fixFilled(r), confirmed: (r.confirmedAt ? 'Cleared ' + ago(r.confirmedAt) : 'Cleared') + (r.heldRuns ? ' · documented hold' : ''),
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
      el('h4', {textContent: 'Fix'}), r.fixes.length ? el('dl', {}, ...r.fixes.flatMap(f => [el('dt', {}, el('code', {className: 'hash', textContent: f.commit})), el('dd', {className: 'muted', textContent: [f.extensionVersion, fixDate(f.landedAt), f.rung != null ? 'rung ' + f.rung : ''].filter(Boolean).join(' · ')})])) : el('div', {className: 'muted', textContent: 'No fix names this replay'}),
      // A shape test guards the mechanism on a small page, not the site: "mechanism guarded", never "passed" or "proven".
      el('h4', {textContent: 'Mechanism guarded · shape tests'}), el('ul', {className: 'fixguard'}, ...r.guard.map(id => { const found = (r.cases || []).find(c => 'recorded:' + c.name === id);
        return el('li', {}, id.replace(':', ' '), found ? el('span', {}, ' ', dots(found.history), ' ', found.ok ? 'mechanism guarded' : 'mechanism broken', found.day ? ' · last ' + found.day : '') : el('span', {className: 'muted', textContent: id.startsWith('fixture:') ? ' (ladder fixture)' : ' (not replayed in the last uploaded run)'})); }))),
    el('div', {}, el('h4', {textContent: 'Runs · filled' + (r.runs.length ? '' : '')}), r.runs.length ? el('ul', {className: 'fixguard'}, ...r.runs.map(run => el('li', {}, run.day + ' · ' + (STAGE[run.reached] || run.reached || 'Nothing reached') + (run.share != null ? ' · ' + run.share + '% filled' : ''), run.after ? el('span', {className: 'muted', textContent: ' · after the fix'}) : null)))
      : el('div', {className: 'muted', textContent: 'No smoke run uploaded for this site.'})));
  const fixRows = r => { const on = fixOpen.has(r.site), kind = fixKind(r), flip = () => { toggleOpen(fixOpen, r.site); drawFixed(); };
    const main = el('tr', {className: 'site' + (on ? ' open' : ''), onclick: flip},
      el('td', {}, el('div', {className: 'sitename'}, el('b', {textContent: fixShort(r.site)}), el('span', {className: 'muted', textContent: r.platform + (r.host ? ' (' + r.host + ')' : '')}))),
      el('td', {}, ...(FAILED.includes(kind) ? [el('a', {className: 'stack muted backlink', href: '#needs-fix', textContent: 'back on Needs a fix', onclick: event => event.stopPropagation()})]
        : [el('span', {className: 'pill s-' + FIX_TONE[kind], textContent: FIX_WORD[kind]}), el('span', {className: 'stack muted', textContent: fixReason(r)}), ...(r.offline && r.offline.verdict === 'holds' ? [el('span', {className: 'pill s-holds', textContent: OFFLINE_WORD.holds})] : []), el('span', {className: 'stack ' + (r.offline && r.offline.verdict === 'confirmed' ? 'muted' : r.offline && r.offline.verdict === 'holds' ? 'muted' : 'warn'), textContent: offlineLine(r)})])),
      el('td', {className: 'c-fill', textContent: fixFilled(r)}),
      el('td', {className: 'c-fix'}, r.commit ? el('code', {className: 'hash', title: r.fixes.map(f => f.commit + ' ' + (f.extensionVersion || '')).join(', '), textContent: r.commit + (r.commits.length > 1 ? ' +' + (r.commits.length - 1) : '')}) : '—', r.commit ? el('span', {className: 'stack muted', textContent: fixDate(r.landedAt) + (r.rung != null ? ' · rung ' + r.rung : '')}) : null),
      el('td', {}, watchButton(r.site, () => { if (!fixOpen.has(r.site)) toggleOpen(fixOpen, r.site); drawFixed(); }), el('button', {className: 'chev', type: 'button', 'aria-expanded': String(on), 'aria-label': (on ? 'Collapse ' : 'Expand ') + r.site, textContent: '›', onclick: event => { event.stopPropagation(); flip(); }})));
    return on ? [main, el('tr', {className: 'more'}, el('td', {colSpan: 5}, fixDetail(r), watchPlayer(r.site)))] : [main]; };
  const FIX_GET = [r => r.site.toLowerCase(), r => FIX_ORDER.indexOf(fixKind(r)), r => (fixShares0(r) ?? null), r => r.landedAt, r => r.guard.length];
  const fixShares0 = r => ((r.filledAfter || []).filter(value => value != null).at(-1));
  // How verification works (owner, 15 Oct 2026: "too verbose, looks like an essay"): the status's own pill and one short line each; the source is a footnote.
  // One row per status: its pill (the same colour the table shows) or a bold word, then a short line. Shared with the Replays tab's "How verdicts work".
  const howList = list => el('dl', {}, ...list.flatMap(([word, text, tone]) => [el('dt', {}, tone ? el('span', {className: 'pill ' + tone, textContent: word}) : word), el('dd', {textContent: text})]));
  const HOW = [['Awaiting verification', 'Fix landed; no run has cleared the site yet.', 's-account'], ['Confirmed', 'Two clean runs after the fix (a hold counts as clean); not a measure of how much more was filled.', 's-ready'],
    ['Confirmed offline', 'Its recording replays further on main than on the build before the fix.', 's-ready'], ['Holds offline', 'Today\\u2019s build still replays as live; the old build cannot be compared.', 's-holds'],
    ['Better, not there yet', 'Still failing, but more fields filled.', 's-form'], ['Still failing', 'Runs after the fix still need a fix.', 's-posting'], ['Regressed', 'Confirmed, then failed again.', 's-posting'],
    ['Filled before \\u2192 after', 'Fields filled: the last run before the fix vs after it.'], ['Shape tests', 'Guard the mechanism on a small page; they never prove the site works.']];
  const howSource = () => 'Source: git trailers and the uploaded runs, ' + (d.fixed.fixesAt ? ago(d.fixed.fixesAt) : 'no upload yet') + '.';
  const drawFixed = () => { fixedBox.textContent = '';
    const all = fixedList().sort((a, b) => FIX_ORDER.indexOf(fixKind(a)) - FIX_ORDER.indexOf(fixKind(b)) || String(b.landedAt || '').localeCompare(String(a.landedAt || ''))), rows = sortRows('fixed', all, FIX_GET);
    const holding = all.filter(r => !FAILED.includes(fixKind(r)));
    const pages = Math.max(1, Math.ceil(rows.length / FIX_PER)); fixPage.n = Math.min(fixPage.n, pages - 1); const from = fixPage.n * FIX_PER, shown = rows.slice(from, from + FIX_PER), go = step => () => { fixPage.n += step; drawFixed(); };
    fixedBox.append(el('div', {className: 'fixpanel'},
      el('div', {className: 'fixhead'}, el('h2', {textContent: 'Fix verification'}), el('p', {className: 'muted', textContent: 'Every landed fix is "Awaiting verification" until two uploaded runs clear it. A fix whose newest run fails again moves back to Needs a fix.'}),
        el('details', {className: 'how'}, el('summary', {textContent: 'How verification works'}), howList(HOW), el('p', {className: 'muted howsrc', textContent: howSource()}))),
      el('div', {className: 'fixbar'}, el('span', {className: 'muted', textContent: 'Awaiting verification first, then newest; fixes that did not hold last'}), el('span', {className: 'muted', textContent: holding.length + (holding.length === 1 ? ' site' : ' sites') + ' with a fix that holds or awaits proof' + (all.length > holding.length ? ' · ' + (all.length - holding.length) + ' back on Needs a fix' : '')})),
      rows.length ? el('table', {className: 'fixtable'}, el('tr', {}, ...heads('fixed', ['Site / platform', 'Verification', 'Filled before → after', 'Fix', 'Details'], () => { fixPage.n = 0; drawFixed(); }).map((th, at) => Object.assign(th, {className: th.className + (at === 2 ? ' c-fill' : at === 3 ? ' c-fix' : '')}))), ...shown.flatMap(fixRows)) : el('p', {className: 'muted', textContent: 'No fix landed yet'}),
      el('div', {className: 'fixfoot'}, el('span', {className: 'muted', textContent: rows.length ? 'Showing ' + (from + 1) + '–' + (from + shown.length) + ' of ' + rows.length + ' fixes' : '0 fixes'}),
        pages > 1 ? el('div', {className: 'pager'}, el('button', {className: 'chip', type: 'button', textContent: '← Previous', disabled: fixPage.n === 0, onclick: go(-1)}), el('button', {className: 'chip', type: 'button', textContent: 'Next →', disabled: fixPage.n >= pages - 1, onclick: go(1)})) : null))); };
  // The To fix tab's sub-tabs (owner, 15 Oct 2026): Needs a fix, By cause, Why fields were left empty. Fixed is a tab of its own now; fixHash (src/applying-pagetabs.js) remembers the sub-tab last shown.
  const showTab = () => { const which = {'#by-cause': 'cause', '#left-empty': 'empty'}[fixHash] || 'needs'; fixBox.hidden = which !== 'needs'; emptyBox.hidden = which !== 'empty'; causeBox.hidden = which !== 'cause';
    const tab = (id, name, text, title) => el('a', {href: '#' + id, role: 'tab', 'aria-selected': String(which === name), className: which === name ? 'on' : '', title: title || '', textContent: text});
    tabs.textContent = ''; tabs.append(tab('needs-fix', 'needs', 'Needs a fix · ' + needsFixOrder(d.pool, d.scorecard, d.steps).rows.length), tab('by-cause', 'cause', 'By cause · ' + causeGroups().length, 'The Needs a fix rows grouped by top cause, and the rows that need a pool run first'),
      tab('left-empty', 'empty', 'Why fields were left empty', 'The required fields the pool\\u2019s fills left empty, by reason, and what the unanswered ones were about')); };
  if (typeof window !== 'undefined') window.addEventListener('hashchange', showTab);
`;
