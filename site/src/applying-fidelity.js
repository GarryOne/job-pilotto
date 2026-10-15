// /admin/lab-form-filling's "Replay vs live (prototype)" (owner, 13 Oct 2026): per pool row that has a live run AND an offline replay of it, how close the replay came to live, for the network
// replay (the new design) beside the snapshot replay (today's). Since 14 Oct 2026 (owner: "the one list") it lists EVERY pool row: where its newest recording was made (Mac or CI) and when,
// or "not recorded", and what is next (record, re-record on the Mac, or deferred with its reason). A PROTOTYPE's numbers: every row says its branch and sha, and nothing here feeds Resolution, the scorecard or the Fixed tab.
// PUT /applying/fidelity (Bearer REPLAYS_PUBLISH_KEY) writes ONE row (the newest record of each pool row, the D1 free plan: 11 Oct 2026). Counts and fixed words only: no page text, no URL, no applicant data.
// Owns FIDELITY_SCRIPT, the client code src/applying.js puts inside its page (it uses that page's el, heads, sortRows, ago). Guard: test/applying-fidelity.test.js.
import {equal} from './guard.js';
import {dropSnapshot} from './applying-store.js';

const KEEP = 200;
const HASH = /^[0-9a-f]{7,40}$/;
const text = (value, max) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const nameOf = value => { const name = text(value, 120); return name && !/[?=@]|:\/\/|https?:/i.test(name) ? name : null; };
const count = value => (Number.isInteger(value) && value >= 0 && value <= 10000 ? value : null);
const word = value => { const out = text(value, 40).toLowerCase(); return /^[a-z0-9_ /+-]*$/.test(out) ? out || null : null; };
const SEEN = ['seen', 'not-seen', 'n/a'], WHERE = ['mac', 'ci'];
const reason = value => { const out = text(value, 160); return out && !/[?=@]|:\/\/|https?:/i.test(out) ? out : null; };   // a deferral's reason, written in the repo (desktop/e2e/replay-deferred.json): no URL, no address
const when = value => { const at = Date.parse(text(value, 40)); return Number.isFinite(at) ? new Date(at).toISOString() : null; };

function side(raw, extra = []) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {filled: count(raw.filled), left: count(raw.left), ending: word(raw.ending)};
  for (const key of extra) out[key] = count(raw[key]);
  return out;
}

// -> a clean record, or null when it lacks a name, a sha or a live run.
export function cleanRecord(item) {
  const name = nameOf(item?.name), sha = text(item?.sha, 40).toLowerCase(), live = side(item?.live, ['asks']);
  if (!name || !HASH.test(sha) || !live || live.asks == null) return null;
  const at = Date.parse(text(item.at, 40));
  const snapshot = side(item.snapshot, ['hit', 'extra']), network = side(item.network, ['hit', 'extra', 'notRecorded', 'orderMatched', 'orderWrong', 'echoed']);
  const live2 = item.live2 && count(item.live2.asks) != null ? {asks: count(item.live2.asks), extraVsLive1: count(item.live2.extraVsLive1)} : null;   // a 2nd live run on the same build: the spread
  if (network) network.afterUpload = SEEN.includes(item.network.afterUpload) ? item.network.afterUpload : null;
  const recording = item.recording && WHERE.includes(item.recording.where) ? {where: item.recording.where, at: when(item.recording.at)} : null;
  return {name, sha, branch: text(item.branch, 80) || null, at: Number.isFinite(at) ? new Date(at).toISOString() : null, live, snapshot, network, live2, recording, deferred: reason(item.deferred), ...(item.answersStale === true ? {answersStale: true} : {}), ...(item.pinned === true ? {pinned: true} : {}), ...(item.gateSame === true ? {gateSame: true} : {})};   // pinned: the row is in desktop/e2e/replay-faithful.json (the replay ratchet)
}

export async function readFidelity(db) {
  const row = await db.prepare("SELECT body FROM applying_fidelity WHERE key = 'prototype'").bind().first().catch(() => null);
  try { return row ? JSON.parse(row.body) : []; } catch { return []; }
}

// {rows: [record]} -> {ok, stored}. A row replaces its older record by name; identical records write nothing.
export async function storeFidelity(db, body, now = new Date()) {
  const fresh = (Array.isArray(body?.rows) ? body.rows.slice(0, KEEP) : []).map(cleanRecord).filter(Boolean).map(item => ({...item, at: item.at || now.toISOString()}));
  if (!fresh.length) return {ok: false, error: 'rows with a name, a sha and a live run are required'};
  const kept = await readFidelity(db), byName = new Map(kept.map(item => [item.name, item]));
  // A replay measured against answers older than the build's prompt (answersStale: its ask changed, the refill has not run yet) never replaces good numbers silently (owner, 15 Oct 2026: "3 of 77" replaced 21 / 13 of 16
  // on a mere stale refill): the earlier record stays and says a newer, stale replay is waiting (refillPending); with no earlier record the stale one is stored, labelled.
  for (const item of fresh) { const prior = byName.get(item.name); byName.set(item.name, item.answersStale && prior && !prior.answersStale ? {...prior, refillPending: true} : item); }
  const next = [...byName.values()].slice(-KEEP);
  if (JSON.stringify(next) === JSON.stringify(kept)) return {ok: true, stored: 0};
  await db.prepare("INSERT INTO applying_fidelity (key, at, body) VALUES ('prototype', ?, ?) ON CONFLICT(key) DO UPDATE SET at = excluded.at, body = excluded.body").bind(now.toISOString(), JSON.stringify(next)).run();
  return {ok: true, stored: fresh.length};
}

// PUT /applying/fidelity. A wrong or missing key is a 404, as the replays and endings routes.
export async function fidelityIngest(request, env, now = new Date()) {
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!(env.REPLAYS_PUBLISH_KEY && equal(given, env.REPLAYS_PUBLISH_KEY)) || !env.STATS) return new Response('Not found', {status: 404});
  const result = await storeFidelity(env.STATS, await request.json().catch(() => null), now);
  if (result.ok && result.stored) await dropSnapshot(env.STATS);
  return Response.json(result, {status: result.ok ? 200 : 400, headers: {'Cache-Control': 'no-store'}});
}

// One replay against its live run. same: every live ask answered from the memo, 0 extra, the same filled and left (compared only when both sides say them: the snapshot replay does not).
// close: every ask answered and the extras within the live-vs-live spread (live2.extraVsLive1, the spec's pass rule); with no second live run, one miss at most. off: otherwise. null: not recorded.
export function verdictOf(live, replay, live2 = null) {
  if (!replay || replay.hit == null) return null;
  const missed = Math.max(0, live.asks - replay.hit), extra = replay.extra || 0, known = replay.filled != null && live.filled != null;
  const sameEnd = !known || (replay.filled === live.filled && replay.left === live.left), spread = live2?.extraVsLive1;
  if (missed === 0 && extra === 0 && sameEnd) return 'same';
  return sameEnd && (spread != null ? missed === 0 && extra <= spread : missed + extra <= 1) ? 'close' : 'off';
}

// A row's next step: deferred (its reason), record (no recording yet), re-record (on the Mac first: its replay is not the same as live, or never ran), or nothing.
export function nextOf(row) {
  if (row.deferred) return {word: 'deferred', why: row.deferred};
  if (!row.live) return {word: 'record', why: 'No network copy yet: record it on the Mac (CI only when the Mac is blocked)'};
  return row.networkVerdict === 'same' ? null : {word: 're-record', why: row.networkVerdict ? 'The replay is not the same as live: re-record it on the Mac' : 'No replay result: re-record it on the Mac'};
}

// (records, the page's pool rows) -> {rows: [{...record, snapshotVerdict, networkVerdict, next}], summary: {total, recorded, network, snapshot}}: every pool row, a row with no record says so
// (network and snapshot: rows that are "same as live").
export function fidelity(records, pool = []) {
  // With a pool, only its rows (owner, 14 Oct 2026: "87 here, 77 in the Pool tab"): a record under another name (an older one named by host, a retired row) is a leftover.
  const names = new Set(pool.map(item => item.shape).filter(Boolean));
  const rows = records.filter(item => !names.size || names.has(item.name)).map(item => ({...item, snapshotVerdict: verdictOf(item.live, item.snapshot, item.live2), networkVerdict: verdictOf(item.live, item.network, item.live2)}));
  const have = new Set(rows.map(item => item.name));
  for (const name of names) if (!have.has(name)) rows.push({name, live: null, snapshot: null, network: null, recording: null, deferred: null, snapshotVerdict: null, networkVerdict: null});
  // Stale (15 Oct 2026): a record the newest upload did not replace (more than 6 h older than the newest one) says so; a row nobody replayed lately must not keep counting as "same".
  const newest = Math.max(0, ...rows.map(item => Date.parse(item.at) || 0));
  for (const item of rows) if (item.at && newest - Date.parse(item.at) > 6 * 3600 * 1000) item.stale = true;
  for (const item of rows) item.next = nextOf(item);
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return {rows, summary: {total: rows.length, recorded: rows.filter(item => item.live).length, network: rows.filter(item => item.networkVerdict === 'same' && !item.stale && !item.answersStale).length, snapshot: rows.filter(item => item.snapshotVerdict === 'same').length,
    ...(rows.some(item => item.gateSame) ? {gate: rows.filter(item => item.gateSame && !item.stale && !item.answersStale).length} : {}),
    ...(rows.some(item => item.stale) ? {stale: rows.filter(item => item.stale).length} : {}),
    ...(rows.some(item => item.answersStale || item.refillPending) ? {awaitingRefill: rows.filter(item => item.answersStale || item.refillPending).length} : {}),   // measured on answers older than main's prompt, or an older number kept while a stale replay waits
    ...(rows.some(item => item.pinned) ? {pinned: rows.filter(item => item.pinned).length, pinnedSame: rows.filter(item => item.pinned && item.networkVerdict === 'same').length} : {})}};   // the ratchet: "N of M same as live (pinned K)"
}

// The section's look (owner mockup, 13 Oct 2026): 64px summary rows with fixed column widths, the details in a full-width row under the open one (the Fixed tab's panel, chevron and "How" parts).
export const FIDELITY_CSS = `
.fidpanel{margin-top:22px}.fidhead{display:flex;flex-wrap:wrap;gap:8px 24px;justify-content:space-between;align-items:flex-start}.fidhead h2{display:flex;align-items:center;gap:10px}.fidhead .proto{font-size:12px;font-weight:500;padding:2px 8px;border:1px solid var(--line);border-radius:6px;color:var(--muted)}.fidhead .score{margin:0 0 2px}.fidhead .how{max-width:520px}.fidhead .how summary{text-align:right}
.fidtable{table-layout:fixed;min-width:720px}.fidtable td,.fidtable th{padding:0 16px;white-space:normal!important;overflow-wrap:anywhere}.fidtable th{height:44px;vertical-align:middle}.fidtable th.c-chev{width:44px;padding:0}.fidtable th.c-rec{width:15%}.fidtable th.c-net{width:17%}.fidtable th.c-verdict{width:12%}.fidtable th.c-next{width:26%}
.fidtable tr.site td{height:64px;vertical-align:middle;box-sizing:border-box;line-height:20px}.fidtable tr.site td.c-chev{padding:0 0 0 12px}.fidtable .chev{padding:0;width:20px;text-align:center}.fidtable .one{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fidtable .sitename b{font-size:14px}
.fidtable tr.more td{padding:0}.fiddetail{padding:16px;background:rgba(255,255,255,.035);border-left:3px solid var(--amber);font-size:13px;line-height:20px}.fiddetail h3{margin:0 0 10px;font-size:14px}.fidgroups{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}
.fidgroups>div{padding:0 20px;border-left:1px solid var(--line);min-width:0}.fidgroups>div:first-child{padding-left:0;border-left:0}.fidgroups h4{margin:0 0 4px;font-size:11px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}.fidgroups div div{overflow-wrap:anywhere}
@media (max-width:900px){.fidgroups{grid-template-columns:minmax(0,1fr);gap:14px}.fidgroups>div{padding:0;border-left:0}.fidtable td,.fidtable th{padding:0 10px}}
`;

export const FIDELITY_SCRIPT = `
  // Replay vs live (prototype): one row per pool row with a live run and an offline replay of it; the network replay (new design) beside the snapshot replay (today's).
  // Owner mockup, 13 Oct 2026: a 64px summary row (scenario, live asks, both replays, the network verdict; two lines at most), everything else in the open row's details.
  const VERDICT_TONE = {same: 's-ready', close: 's-form', off: 's-posting'}, VERDICT_WORD = {same: 'Exact', close: 'Close', off: 'Off'};   // "Exact" (owner, 15 Oct 2026): "same as live" named two numbers; the strict one is Exact, the gate is Passes gate
  const outcome = side => (side && (side.filled != null || side.left != null) ? (side.filled ?? '–') + ' filled · ' + (side.left ?? '–') + ' left' : 'not available');
  const hits = (live, side) => (live && side && side.hit != null ? side.hit + ' / ' + live.asks + ' hit · ' + (side.extra || 0) + ' extra' : '—');
  const verdictPill = word => (word ? el('span', {className: 'pill ' + VERDICT_TONE[word], textContent: VERDICT_WORD[word]}) : el('span', {className: 'muted', textContent: 'No network copy'}));
  // A pool row's name -> {title, sub}: "x (found 2026-10-10)" -> x, "Found 10 Oct 2026"; "a -> b: steps" -> "a → b", steps. The full name is in the details.
  const fidParts = name => { const found = name.match(/^(.*?)\\s*\\(found (\\d{4}-\\d{2}-\\d{2})\\)\\s*$/), cut = name.indexOf(': ');
    const [title, sub] = found ? [found[1], 'Found ' + new Date(found[2] + 'T00:00:00Z').toUTCString().slice(5, 16)] : cut > 0 ? [name.slice(0, cut), name.slice(cut + 2)] : [name, ''];
    return {title: title.replace(/ -> /g, ' → '), sub}; };
  const NEXT_WORD = {record: 'Record', 're-record': 'Re-record', deferred: 'Deferred'};
  const recorded = r => (r.recording ? (r.recording.where === 'mac' ? 'Mac' : 'CI') + (r.recording.at ? ' · ' + ago(r.recording.at) : '') : r.live ? 'Recorded (source not kept)' : 'No network copy');
  const fidOpen = new Set();
  const fidDetail = r => { const n = r.network, line = text => el('div', {textContent: text});
    if (!r.live) return el('div', {className: 'fiddetail'}, el('h3', {textContent: r.name.replace(/ -> /g, ' → ')}), line('No network copy yet. ' + (r.next ? r.next.why : '')),
      line('Record on the Mac: cd desktop/e2e && JP_NET_RECORD_DIR=<dir> npm run record-sites -- --only "' + r.name + '", then node records-publish.mjs <dir>.'));
    return el('div', {className: 'fiddetail'}, el('h3', {textContent: r.name.replace(/ -> /g, ' → ') + ' · comparison details'}), el('div', {className: 'fidgroups'},
      el('div', {}, el('h4', {textContent: 'Live baseline'}), line('Recording: ' + recorded(r) + ' · ' + r.live.asks + ' live asks'), r.next ? line('Next: ' + r.next.why) : null, line(outcome(r.live)), line('Stage: ' + (r.live.ending || '—')), line(r.live2 ? 'Second live: ' + r.live2.asks + ' asks · ' + (r.live2.extraVsLive1 ?? '–') + ' extra' : 'Second live: none')),
      el('div', {}, el('h4', {textContent: 'Replay diagnostics'}), n ? line('By order: ' + (n.orderMatched ?? '–') + ' OK · ' + (n.orderWrong || 0) + ' wrong · ' + (n.echoed || 0) + ' echoed') : line('Network replay: not recorded yet'),
        n ? line('Network filled / left: ' + outcome(n)) : null, line('Snapshot filled / left: ' + outcome(r.snapshot)), n ? line('Not recorded: ' + (n.notRecorded ?? '—')) : null),
      el('div', {}, el('h4', {textContent: 'Upload & build'}), line('After upload: ' + (n?.afterUpload || '—')),
        el('div', {}, el('a', {className: 'hash', href: 'https://github.com/GarryOne/job-pilotto/commit/' + r.sha, textContent: r.sha.slice(0, 7)}), r.branch ? ' ' + r.branch : ''), line('Built ' + (r.at ? ago(r.at) : '—'))))); };
  const fidRows = (r, redraw) => { const on = fidOpen.has(r.name), flip = () => { toggleOpen(fidOpen, r.name); redraw(); }, parts = fidParts(r.name);
    const main = el('tr', {className: 'site' + (on ? ' open' : ''), onclick: flip},
      el('td', {className: 'c-chev'}, el('button', {className: 'chev', type: 'button', 'aria-expanded': String(on), 'aria-label': (on ? 'Collapse ' : 'Expand ') + r.name, textContent: '›', onclick: event => { event.stopPropagation(); flip(); }})),
      el('td', {title: r.name}, el('div', {className: 'sitename'}, el('b', {className: 'one', textContent: parts.title}), parts.sub ? el('span', {className: 'muted one', textContent: parts.sub}) : null)),
      el('td', {}, el('span', {className: 'one' + (r.live ? '' : ' muted'), textContent: recorded(r)})),
      el('td', {}, el('span', {className: 'one', textContent: hits(r.live, r.network)})),
      el('td', {}, verdictPill(r.networkVerdict), r.answersStale || r.refillPending ? el('span', {className: 'muted one', textContent: r.refillPending ? 'a newer replay waits for the refill' : 'answers older than main\\'s prompt: refill pending'}) : null),
      el('td', {title: r.next ? r.next.why : ''}, r.next ? el('div', {}, el('b', {className: 'one', textContent: NEXT_WORD[r.next.word]}), el('span', {className: 'muted one', textContent: r.next.why})) : el('span', {className: 'muted', textContent: '—'})));
    return on ? [main, el('tr', {className: 'more'}, el('td', {colSpan: 6}, fidDetail(r)))] : [main]; };
  // How verdicts work (owner, 15 Oct 2026: short, not an essay): the verdict's own pill and one line each.
  const FID_HOW = [['Same', 'Every live ask answered, nothing extra, same filled and left.', 's-ready'], ['Close', 'Within the spread of two live runs (one miss at most).', 's-form'], ['Off', 'Otherwise.', 's-posting'],
    ['Next', 'Record (no copy) \\u00b7 Re-record (off) \\u00b7 Deferred (its reason shown).'], ['Recording', 'Where and when the newest copy was made (Mac or CI).'], ['Snapshot replay', 'The older replay, judged on its asks only.']];
  function drawFidelity(box, f) {
    box.textContent = '';
    if (!f || !f.rows.length) return;
    const FID_GET = [null, r => r.name.toLowerCase(), r => (r.recording && r.recording.at) || (r.live ? '0' : ''), r => (r.network ? r.network.hit : null), r => ['same', 'close', 'off'].indexOf(r.networkVerdict), r => (r.next ? r.next.word : '')];
    const redraw = () => { state.page = 0; drawFidelity(box, f); }, state = (drawFidelity.state ||= {query: '', page: 0, verdict: ''});
    // One test per chip, the same the headline counts: the gate (no extra ask, fresh answers) or the row's strict verdict.
    const verdictIs = (r, value) => (value === 'gate' ? !!(r.gateSame && !r.stale && !r.answersStale) : (r.networkVerdict || 'none') === value);
    const matches = r => wordsIn([r.name, r.networkVerdict || 'not recorded yet', r.branch || '', r.next ? r.next.word : '', recorded(r)].join(' ').toLowerCase(), state.query) && (!state.verdict || verdictIs(r, state.verdict));
    const rows = sortRows('fidelity', f.rows.filter(matches), FID_GET), pages = Math.max(1, Math.ceil(rows.length / 15));
    state.page = Math.min(state.page, pages - 1);
    const from = state.page * 15, shown = rows.slice(from, from + 15), s = f.summary, go = step => () => { state.page += step; drawFidelity(box, f); };
    const search = el('input', {type: 'search', value: state.query, placeholder: 'Search rows or branches…', 'aria-label': 'Search replay vs live', autocomplete: 'off', oninput: event => { state.query = event.target.value; state.page = 0; drawFidelity(box, f); event.target.focus(); }});
    const verdict = chipFilter('Verdict', [['', 'All · ' + f.rows.length], ...[['gate', 'Passes gate'], ['same', 'Exact'], ['close', 'Close'], ['off', 'Off'], ['none', 'No network copy']].map(([value, label]) => [value, label + ' · ' + f.rows.filter(r => verdictIs(r, value)).length])], state.verdict, value => { state.verdict = value; redraw(); });   // chips (owner, 15 Oct 2026)
    box.append(el('div', {className: 'fixpanel fidpanel'},
      el('div', {className: 'fixhead fidhead'}, el('div', {}, el('h2', {}, 'Replay vs live', el('span', {className: 'proto', textContent: 'Prototype'})),
          el('p', {className: 'score', textContent: 'Network replay: ' + (s.gate != null ? s.gate + ' of ' + s.total + ' pass the gate (no question live did not ask) · ' + s.network + ' exact (every answer identical to live)' : s.network + ' of ' + s.total + ' pool rows same as live') + (s.stale ? ' · ' + s.stale + ' stale (not replayed in the latest run)' : '') + (s.awaitingRefill ? ' · ' + s.awaitingRefill + ' waiting for the refill (answers older than main\\'s prompt; the numbers above are not replaced by them)' : '') + (s.pinned != null ? ' (pinned: ' + s.pinnedSame + ' of ' + s.pinned + ' exact)' : '') + ' · ' + s.recorded + ' recorded · Snapshot: ' + s.snapshot}),
          el('p', {className: 'muted', textContent: 'Experimental results: excluded from Resolution, the scorecard and the Fixed tab.'})),
        el('details', {className: 'how'}, el('summary', {textContent: 'How verdicts work'}), howList(FID_HOW))),
      el('div', {className: 'filters'}, el('label', {className: 'pick search'}, el('span', {className: 'muted', textContent: 'Search'}), search), verdict,
        el('span', {className: 'muted count', textContent: f.rows.length + (f.rows.length === 1 ? ' pool row' : ' pool rows')})),
      rows.length ? el('table', {className: 'fidtable'}, el('tr', {}, ...heads('fidelity', ['', 'Scenario', 'Recording', 'Network replay', 'Verdict', 'Next'], redraw).map((th, at) => Object.assign(th, at ? {className: th.className + ' ' + ['', 'c-name', 'c-rec', 'c-net', 'c-verdict', 'c-next'][at]} : {className: 'c-chev', title: '', tabIndex: -1, onclick: null, onkeydown: null, 'aria-label': 'Details'}))),
        ...shown.flatMap(r => fidRows(r, () => drawFidelity(box, f)))) : el('p', {className: 'muted', style: 'padding:0 16px', textContent: 'No row matches.'}),
      el('div', {className: 'fixfoot'}, el('span', {className: 'muted', textContent: 'Showing ' + (rows.length ? from + 1 : 0) + '–' + (from + shown.length) + ' of ' + rows.length}),
        pages > 1 ? el('div', {className: 'pager'}, el('button', {className: 'chip', type: 'button', textContent: '← Previous', disabled: state.page === 0, onclick: go(-1)}), el('button', {className: 'chip', type: 'button', textContent: 'Next →', disabled: state.page >= pages - 1, onclick: go(1)})) : null)));
  }
`;
