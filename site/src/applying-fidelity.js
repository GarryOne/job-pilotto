// /admin/applying's "Replay vs live (prototype)" (owner, 13 Oct 2026): per pool row that has a live run AND an offline replay of it, how close the replay came to live, for the network
// replay (the new design) beside the snapshot replay (today's). A PROTOTYPE's numbers: every row says its branch and sha, and nothing here feeds Resolution, the scorecard or the Fixed tab.
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
const SEEN = ['seen', 'not-seen', 'n/a'];

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
  return {name, sha, branch: text(item.branch, 80) || null, at: Number.isFinite(at) ? new Date(at).toISOString() : null, live, snapshot, network, live2};
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
  for (const item of fresh) byName.set(item.name, item);
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

// -> {rows: [{...record, snapshotVerdict, networkVerdict}], summary: {total, network, snapshot}} (network and snapshot: rows that are "same as live").
export function fidelity(records) {
  const rows = records.map(item => ({...item, snapshotVerdict: verdictOf(item.live, item.snapshot, item.live2), networkVerdict: verdictOf(item.live, item.network, item.live2)}))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {rows, summary: {total: rows.length, network: rows.filter(item => item.networkVerdict === 'same').length, snapshot: rows.filter(item => item.snapshotVerdict === 'same').length}};
}

export const FIDELITY_SCRIPT = `
  // Replay vs live (prototype): one row per pool row with a live run and an offline replay of it; the network replay (new design) beside the snapshot replay (today's).
  const VERDICT_TONE = {same: 's-ready', close: 's-form', off: 's-posting'};
  const outcome = side => (side ? (side.filled ?? '–') + ' filled / ' + (side.left ?? '–') + ' left' + (side.ending ? ', ' + side.ending : '') : '—');
  const hits = (live, side) => (side && side.hit != null ? side.hit + ' of ' + live.asks + ' hit, ' + (side.extra || 0) + ' extra' : '—');
  const verdictPill = word => (word ? el('span', {className: 'pill ' + VERDICT_TONE[word], textContent: word}) : el('span', {className: 'muted', textContent: 'not recorded yet'}));
  function drawFidelity(box, f) {
    box.textContent = '';
    if (!f || !f.rows.length) return;
    const FID_GET = [r => r.name.toLowerCase(), r => r.live.asks, r => (r.snapshot ? r.snapshot.hit : null), r => (r.network ? r.network.hit : null), r => (r.network ? r.network.notRecorded : null), r => r.network?.afterUpload || '', r => ['same', 'close', 'off'].indexOf(r.networkVerdict), r => r.at];
    const redraw = () => { state.page = 0; drawFidelity(box, f); }, state = (drawFidelity.state ||= {query: '', page: 0, verdict: ''});
    const matches = r => wordsIn([r.name, r.networkVerdict || 'not recorded yet', r.branch || ''].join(' ').toLowerCase(), state.query) && (!state.verdict || (r.networkVerdict || 'none') === state.verdict);
    const rows = sortRows('fidelity', f.rows.filter(matches), FID_GET), pages = Math.max(1, Math.ceil(rows.length / 15));
    state.page = Math.min(state.page, pages - 1);
    const shown = rows.slice(state.page * 15, state.page * 15 + 15), s = f.summary;
    const search = el('input', {type: 'search', value: state.query, placeholder: 'Row, verdict or branch', 'aria-label': 'Search replay vs live', autocomplete: 'off', oninput: event => { state.query = event.target.value; state.page = 0; drawFidelity(box, f); event.target.focus(); }});
    const verdict = Object.assign(el('select', {onchange: event => { state.verdict = event.target.value; redraw(); }}, ...[['', 'All verdicts'], ['same', 'Same as live'], ['close', 'Close'], ['off', 'Off'], ['none', 'Not recorded yet']].map(([value, label]) => el('option', {value, textContent: label}))), {value: state.verdict});
    box.append(el('h2', {textContent: 'Replay vs live (prototype)'}),
      el('p', {className: 'muted', textContent: 'Network replay: ' + s.network + ' of ' + s.total + ' rows same as live (snapshot: ' + s.snapshot + ' of ' + s.total + '). A prototype\\'s numbers from a branch: they never feed Resolution, the scorecard or the Fixed tab. same = every live ask answered from the memo, 0 extra, same filled and left; close = extras within the live-vs-live spread; off = otherwise.'}),
      el('div', {className: 'filters'}, el('label', {className: 'pick search'}, el('span', {className: 'muted', textContent: 'Search'}), search), el('label', {className: 'pick'}, el('span', {className: 'muted', textContent: 'Verdict'}), verdict),
        el('span', {className: 'muted count', textContent: 'Showing ' + (rows.length ? state.page * 15 + 1 : 0) + '–' + (state.page * 15 + shown.length) + ' of ' + rows.length}),
        el('div', {className: 'pager'}, ...(pages > 1 ? [el('button', {className: 'chip', type: 'button', textContent: '← Previous', disabled: state.page === 0, onclick: () => { state.page -= 1; drawFidelity(box, f); }}),
          el('button', {className: 'chip', type: 'button', textContent: 'Next →', disabled: state.page >= pages - 1, onclick: () => { state.page += 1; drawFidelity(box, f); }})] : []))),
      rows.length ? el('table', {className: 'fit'}, el('tr', {}, ...heads('fidelity', ['Row', 'Live asks', 'Snapshot replay', 'Network replay', 'Not recorded', 'After upload', 'Verdict', 'Built'], redraw)),
        ...shown.map(r => el('tr', {}, el('td', {}, r.name, el('div', {className: 'muted clamp', textContent: 'live: ' + outcome(r.live) + (r.live2 ? ' · 2nd live: ' + r.live2.asks + ' asks, ' + r.live2.extraVsLive1 + ' extra' : '')})), el('td', {className: 'muted', textContent: r.live.asks}),
          el('td', {className: 'muted'}, hits(r.live, r.snapshot), el('div', {className: 'stack', textContent: outcome(r.snapshot)}), r.snapshotVerdict ? verdictPill(r.snapshotVerdict) : null),
          el('td', {className: 'muted'}, hits(r.live, r.network), el('div', {className: 'stack', textContent: outcome(r.network)}), r.network && r.network.orderMatched != null ? el('div', {className: 'stack', textContent: 'by order ' + r.network.orderMatched + ' ok, ' + (r.network.orderWrong || 0) + ' wrong, ' + (r.network.echoed || 0) + ' echoed'}) : null),
          el('td', {className: 'muted', textContent: r.network && r.network.notRecorded != null ? r.network.notRecorded : '—'}), el('td', {className: 'muted', textContent: r.network?.afterUpload || '—'}),
          el('td', {}, verdictPill(r.networkVerdict)), el('td', {className: 'muted'}, el('a', {className: 'hash', href: 'https://github.com/GarryOne/job-pilotto/commit/' + r.sha, textContent: r.sha.slice(0, 7)}), el('div', {className: 'stack', textContent: (r.branch || '') + ' · ' + (r.at ? ago(r.at) : '')}))))) : el('p', {className: 'muted', textContent: 'No row matches.'}));
  }
`;
