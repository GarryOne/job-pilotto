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

// -> {day, rows, inProgress, claimsAt, fixesAt, replays}. pool: the page's pool rows (name as shown, shape, platform, runs); cases: the recorded cases.
// Marks each pool row with `back` and `claimed` for the Needs a fix tab.
export async function fixedData(db, pool, cases, now = new Date()) {
  const fixes = await all(db, 'SELECT * FROM applying_fixes ORDER BY landed_at');
  const snapshots = Object.fromEntries((await all(db, 'SELECT kind, at FROM applying_snapshots')).map(row => [row.kind, row.at]));
  const claims = await all(db, 'SELECT site, since FROM applying_claims ORDER BY since');
  const bySite = fixes.reduce((out, fix) => ((out[fix.site] ||= []).push(fix), out), {}), caseByName = new Map(cases.map(item => [item.name, item])), guarded = new Set();
  const rows = Object.entries(bySite).map(([site, list]) => {
    const last = list.at(-1), item = pool.find(row => row.name === site || row.shape === site);
    const guard = [...new Set(list.flatMap(fix => JSON.parse(fix.guard || '[]')))];
    const linked = guard.filter(id => id.startsWith('recorded:')).map(id => caseByName.get(id.slice(9))).filter(Boolean);
    linked.forEach(found => guarded.add(found.name));
    return {site, platform: item?.platform ?? '—', commit: last.commit_hash, commits: list.map(fix => fix.commit_hash), extensionVersion: last.version, rung: last.rung, landedAt: last.landed_at,
      ...statusOf(item?.runs || [], last.landed_at), guard, cases: linked.map(found => ({name: found.name, ok: found.ok, history: found.history}))};
  }).sort((a, b) => b.landedAt.localeCompare(a.landedAt));
  const claimed = new Map(claims.map(row => [row.site, row.since])), back = new Set(rows.filter(row => row.status === 'back').map(row => row.site));
  for (const item of pool) { item.claimed = claimed.get(item.name) ?? claimed.get(item.shape) ?? null; item.back = back.has(item.name); }
  return {day: now.toISOString().slice(0, 10), rows, inProgress: claims.map(row => ({site: row.site, since: row.since})), claimsAt: snapshots.claims ?? null, fixesAt: snapshots.fixes ?? null,
    replays: cases.filter(item => !guarded.has(item.name)).map(item => ({name: item.name, ok: item.ok, rung: item.rung, history: item.history, day: item.day, version: item.version}))};
}

// The tab's client code, inside the page's fetch callback (needs el, block, dots, ago, d, fixBox, fixedBox, tabs). Plain quotes only: it sits in a template literal.
export const FIXED_SCRIPT = `
  // The Fixed tab (owner, 11 Oct 2026; src/applying-fixed.js): one row per fixed pool row, its fix, and whether an uploaded run after it confirmed it; a replay no fix names keeps its row here.
  const FIX_STATUS = {landed: ['Landed, unconfirmed', 'account'], confirmed: ['Confirmed', 'ready'], back: ['Back', 'posting'], replay: ['Replay only', 'none']}, FIX_ORDER = ['back', 'landed', 'confirmed', 'replay'];
  const fixStatus = r => (r.status === 'landed' && r.failingRuns ? 'Landed, not better yet (' + r.failingRuns + (r.failingRuns === 1 ? ' run)' : ' runs)') : FIX_STATUS[r.status][0]);
  const fixShares = list => (list || []).filter(value => value != null);
  const fixFilled = r => (fixShares(r.filledBefore).length || fixShares(r.filledAfter).length ? (fixShares(r.filledBefore).join(', ') || '—') + ' → ' + (fixShares(r.filledAfter).join(', ') || '—') + '%' : '—');
  const fixedList = () => [...d.fixed.rows, ...d.fixed.replays.map(c => ({site: c.name, platform: '—', status: 'replay', guard: ['recorded:' + c.name], cases: [c], filledBefore: [], filledAfter: [], landedAt: null}))];
  const guardCell = r => el('td', {className: 'muted'}, ...r.guard.map(id => { const found = (r.cases || []).find(c => 'recorded:' + c.name === id);
    return el('span', {className: 'stack'}, id.replace(':', ' '), found ? el('span', {}, ' ', dots(found.history)) : null); }));
  const drawFixed = () => { fixedBox.textContent = '';
    fixedBox.append(el('h2', {textContent: 'Fixed · every fix and what the runs after it show'}),
      el('p', {className: 'muted', textContent: 'Reading it: every landed fix shows "Landed, unconfirmed" until an uploaded run clears it; "Landed, not better yet" counts the runs since that still failed; "Back" when a run after the confirmation lists it again (it is then on Needs a fix too). From git trailers (Pool-row, Rung, Fixture) and the smoke runs, as of ' + (d.fixed.fixesAt ? ago(d.fixed.fixesAt) : 'no upload yet') + '. The guard dots are the recorded replay, green passed, red failed.'}),
      ...block('fixed', 'Fixes', 'Back first, then newest', fixedList().sort((a, b) => FIX_ORDER.indexOf(a.status) - FIX_ORDER.indexOf(b.status) || String(b.landedAt || '').localeCompare(String(a.landedAt || ''))),
        ['Site', 'Platform', 'Fix', 'Status', 'Filled before → after', 'Guard'],
        r => el('tr', {}, el('td', {textContent: r.site}), el('td', {textContent: r.platform}),
          el('td', {className: 'muted'}, r.commit ? el('span', {className: 'stack', textContent: r.commit + (r.commits && r.commits.length > 1 ? ' +' + (r.commits.length - 1) : '') + (r.extensionVersion ? ' · ' + r.extensionVersion : '')}) : '—',
            r.commit ? el('span', {className: 'stack', textContent: 'rung ' + (r.rung ?? '?') + ' · ' + r.landedAt.slice(0, 10)}) : null),
          el('td', {}, el('span', {className: 'pill s-' + FIX_STATUS[r.status][1], textContent: fixStatus(r)}), r.confirmedAt ? el('span', {className: 'stack muted', textContent: 'cleared ' + ago(r.confirmedAt)}) : null),
          el('td', {className: 'muted', textContent: fixFilled(r)}), guardCell(r)),
        'No fix landed yet', () => drawFixed(), [r => r.site.toLowerCase(), r => r.platform, r => r.landedAt, r => FIX_ORDER.indexOf(r.status), r => fixShares(r.filledAfter).at(-1) ?? null, r => r.guard.length]).filter(Boolean)); };
  const showTab = () => { const fixed = typeof location !== 'undefined' && location.hash === '#fixed'; fixBox.hidden = fixed; fixedBox.hidden = !fixed;
    tabs.textContent = ''; tabs.append(el('a', {href: '#needs-fix', className: 'chip' + (fixed ? '' : ' on'), textContent: 'Needs a fix · ' + d.pool.filter(needs).length}),
      el('a', {href: '#fixed', className: 'chip' + (fixed ? ' on' : ''), textContent: 'Fixed · ' + d.fixed.rows.length})); };
  if (typeof window !== 'undefined') window.addEventListener('hashchange', showTab);
`;
