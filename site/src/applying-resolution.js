// /admin/applying's Resolution tile, the page's headline (the outcome contract, owner 12 Oct 2026; spec docs/superpowers/specs/2026-10-12-one-next-move.md, phase 1a): every application
// ends in one fixed ending (extension/ladder/endings.js); this is each pool row's NEWEST ending, from the owner's Mac uploads of main's build (applying_runs.ending, on_main = 1: a
// branch's run never counts, migration 0061) and CI's pool runs on main
// (PUT /applying/endings, the narrow REPLAYS_PUBLISH_KEY, one row of the last 600 records), the share resolved raw and weighted by real demand (the scorecard's match share, with the
// rows each platform rests on), the rows held by the test apart (never measured), the unresolved rows first (the work list) and a weekly trend. A PR's run never counts here.
// Owns RESOLUTION_SCRIPT and RESOLUTION_CSS, the client code src/applying.js puts inside its page (it uses that page's el, tile and ago). Guard: test/applying-resolution.test.js.
import {ENDINGS, resolved} from '../../extension/ladder/endings.js';
import {equal} from './guard.js';
import {dropSnapshot} from './applying-store.js';

export const ENDING_WORDS = [...ENDINGS, 'held'];   // 'held': the test's own hold (never an account button with fake data, a bot wall on a CI address)
const KEEP = 600, WEEKS = 6;
const text = (value, max) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const nameOf = value => { const name = text(value, 120); return name && !/[?=@]|:\/\/|https?:/i.test(name) ? name : null; };
const isoOf = value => { const time = Date.parse(text(value, 40)); return Number.isFinite(time) ? new Date(time).toISOString() : null; };
export const endingWord = value => (ENDING_WORDS.includes(value) ? value : null);

export async function readEndings(db) {
  const row = await db.prepare("SELECT body FROM applying_endings WHERE key = 'all'").bind().first().catch(() => null);
  try { return row ? JSON.parse(row.body) : []; } catch { return []; }
}

// {records: [{row, ending, run, branch, sha, at}]} -> {ok, stored}. Identical (run, row) records write nothing.
export async function storeEndings(db, body, now = new Date()) {
  const incoming = Array.isArray(body?.records) ? body.records.slice(0, 200) : [];
  if (!incoming.length) return {ok: false, error: 'records are required'};
  const fresh = [];
  for (const item of incoming) {
    const row = nameOf(item?.row), ending = endingWord(item?.ending), run = text(item?.run, 20), at = isoOf(item?.at);
    if (!row || !ending || !/^\d+$/.test(run) || !at) continue;
    fresh.push({row, ending, run, branch: text(item.branch, 80) || null, sha: /^[0-9a-f]{7,40}$/.test(text(item.sha, 40)) ? text(item.sha, 40) : null, at});
  }
  if (!fresh.length) return {ok: true, stored: 0};
  const kept = await readEndings(db), known = new Set(kept.map(item => `${item.run}\n${item.row}`)), added = fresh.filter(item => !known.has(`${item.run}\n${item.row}`));
  if (!added.length) return {ok: true, stored: 0};
  const next = [...kept, ...added].sort((a, b) => a.at.localeCompare(b.at)).slice(-KEEP);
  await db.prepare("INSERT INTO applying_endings (key, at, body) VALUES ('all', ?, ?) ON CONFLICT(key) DO UPDATE SET at = excluded.at, body = excluded.body").bind(now.toISOString(), JSON.stringify(next)).run();
  return {ok: true, stored: added.length};
}

// PUT /applying/endings. A wrong or missing key is a 404, as the replays and proven routes.
export async function endingsIngest(request, env, now = new Date()) {
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!(env.REPLAYS_PUBLISH_KEY && equal(given, env.REPLAYS_PUBLISH_KEY)) || !env.STATS) return new Response('Not found', {status: 404});
  const result = await storeEndings(env.STATS, await request.json().catch(() => null), now);
  if (result.ok && result.stored) await dropSnapshot(env.STATS);
  return Response.json(result, {status: result.ok ? 200 : 400, headers: {'Cache-Control': 'no-store'}});
}

// The Monday of a day's ISO week (UTC).
const weekOf = at => { const date = new Date(at); const back = (date.getUTCDay() + 6) % 7; return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - back)).toISOString().slice(0, 10); };
const pct = (part, whole) => (whole ? Math.round((100 * part) / whole) : null);

// runs: the page's latest runs (applying_runs rows, each with `ending`); endings: CI's records; pool: the page's pool rows ({shape, platform}); scorecard: [{platform, matchShare}].
// -> {measured, held, resolved, raw, weighted, covered, samples, endings, unresolved, weeks}
export function resolution({runs = [], endings = [], pool = [], scorecard = [], now = new Date()} = {}) {
  const inPool = new Map(pool.map(item => [item.shape, item.platform || 'Custom']));
  const all = [...runs.filter(run => run.kind === 'smoke' && run.on_main === 1 && endingWord(run.ending)).map(run => ({row: run.name, ending: run.ending, at: run.at, source: 'mac'})),
    ...endings.filter(item => item.branch === 'main' && endingWord(item.ending)).map(item => ({row: item.row, ending: item.ending, at: item.at, source: 'ci'}))]
    .filter(item => inPool.has(item.row) && isoOf(item.at) && Date.parse(item.at) <= now.getTime()).sort((a, b) => a.at.localeCompare(b.at));
  const newest = list => [...list.reduce((out, item) => out.set(item.row, item), new Map()).values()];
  const latest = newest(all), measured = latest.filter(item => item.ending !== 'held');
  const counts = Object.fromEntries(ENDINGS.map(one => [one, measured.filter(item => item.ending === one).length]));
  const resolvedRows = measured.filter(item => resolved(item.ending)).length;
  // Weighted by real demand: each platform's share resolved times its match share; a platform with no measured row weighs nothing, and its sample is said beside the number.
  let sum = 0, covered = 0;
  const samples = [...scorecard].filter(item => Number(item.matchShare) > 0).sort((a, b) => b.matchShare - a.matchShare).map(item => {
    const mine = measured.filter(row => inPool.get(row.row) === item.platform);
    if (mine.length) { sum += item.matchShare * (mine.filter(row => resolved(row.ending)).length / mine.length); covered += item.matchShare; }
    return {platform: item.platform, share: item.matchShare, rows: mine.length};
  });
  const weeks = Object.entries(all.reduce((out, item) => ((out[weekOf(item.at)] ||= []).push(item), out), {})).sort(([a], [b]) => a.localeCompare(b)).slice(-WEEKS)
    .map(([week, list]) => { const rows = newest(list).filter(item => item.ending !== 'held'); return {week, measured: rows.length, raw: pct(rows.filter(item => resolved(item.ending)).length, rows.length)}; });
  return {measured: measured.length, held: latest.length - measured.length, resolved: resolvedRows, raw: pct(resolvedRows, measured.length), weighted: covered ? Math.round(sum / covered * 100) : null, covered, samples,
    endings: counts, unresolved: measured.filter(item => item.ending === 'unresolved').map(item => ({row: item.row, platform: inPool.get(item.row), source: item.source, day: item.at.slice(0, 10)})), weeks};
}

// The client side, inside src/applying.js's page: the headline tile (raw, weighted, unresolved) and the section under the tiles (endings, the work list, the sample, the weeks).
// drawResolution fills its box once the page's table helpers exist (heads, sortRows: every table sorts through them).
export const RESOLUTION_CSS = '.resolution .endings{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 10px}.resolution .endings .pill{color:#fff}.resolution table{margin-top:6px}'
  + '.resolution .sample{overflow-wrap:anywhere}';
export const RESOLUTION_SCRIPT = `
  const ENDING_TONE = {ready: 's-ready', told: 's-form', handed: 's-form', blind: 's-account', data_missing: 's-account', site_broken: 's-none', unresolved: 's-posting'};
  // A snapshot computed before this tile existed (the page's data is kept 10 minutes) has no resolution: an empty tile, an empty box.
  const resolutionTile = r => tile(!r || r.raw == null ? '–' : r.raw + '%', 'Resolved', !r || r.raw == null ? '' : r.unresolved.length ? 'bad' : 'good',
    !r ? 'No ending yet' : (r.weighted == null ? 'No demand weight yet' : r.weighted + '% weighted by demand') + ' · ' + r.unresolved.length + ' unresolved',
    'The newest run of each pool row ends in one fixed ending; resolved = every ending but unresolved. Only runs of main count: CI on main, and Mac runs whose extension is the one on main.' + (r ? ' ' + r.held + ' row(s) held by the test are not measured.' : ''));
  function drawResolution(box, r) {
    box.textContent = '';
    if (!r) return;
    const redraw = () => drawResolution(box, r);
    const UNRESOLVED_GET = [item => item.row.toLowerCase(), item => item.platform, item => item.day], WEEK_GET = [week => week.week, week => week.measured, week => week.raw];
    box.append(...[el('h2', {textContent: 'Resolution · how each application ends'}),   // filtered: append() writes a null as the text "null"
      el('p', {className: 'muted', textContent: r.measured ? r.resolved + ' of ' + r.measured + ' pool rows resolved (' + r.raw + '%)' + (r.weighted == null ? '' : '; weighted by real demand ' + r.weighted + '%') + '. ' + r.held + ' held by the test (an account the pool never creates, a bot wall on a CI address): not measured.' : 'No ending uploaded yet: the next pool run sends them.'}),
      el('div', {className: 'endings'}, ...Object.entries(r.endings).map(([ending, n]) => el('span', {className: 'pill ' + ENDING_TONE[ending], textContent: ending.replace('_', ' ') + ' ' + n}))),
      r.unresolved.length ? el('table', {className: 'fit'}, el('tr', {}, ...heads('resolution', ['Unresolved (the work list)', 'Platform', 'Last run'], redraw)),
        ...sortRows('resolution', r.unresolved, UNRESOLVED_GET).map(item => el('tr', {}, el('td', {textContent: item.row}), el('td', {className: 'muted', textContent: item.platform}), el('td', {className: 'muted', textContent: item.day + ' · ' + (item.source === 'ci' ? 'CI' : 'Mac')})))) : el('p', {className: 'muted', textContent: 'Nothing unresolved.'}),
      r.samples.length ? el('p', {className: 'muted sample', textContent: 'Weighted by the share of matched jobs per platform; rows behind it: ' + r.samples.map(item => item.platform + ' ' + item.share + '%: ' + item.rows).join(' · ') + '. A platform with few rows moves the weighted number a lot.'}) : null,
      r.weeks.length > 1 ? el('table', {className: 'fit'}, el('tr', {}, ...heads('weeks', ['Week of', 'Rows', 'Resolved'], redraw)),
        ...sortRows('weeks', r.weeks, WEEK_GET).map(week => el('tr', {}, el('td', {textContent: week.week}), el('td', {className: 'muted', textContent: week.measured}), el('td', {textContent: week.raw == null ? '–' : week.raw + '%'})))) : null].filter(Boolean));
  }
`;
