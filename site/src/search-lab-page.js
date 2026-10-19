// /admin/lab-job-search (owner, 18 Oct 2026; sketch https://claude.ai/artifact/FsAAKdxxXF2wXpD1nbHAuC): does a new user get relevant jobs fast, in any role and place, and did our last change make it
// better or worse? PR 1 draws the Lab tab only: one row per fictional candidate from its newest replayed search (src/search-lab-store.js), judged against its last green run (src/search-lab-judge.js).
// Counts, seconds and a build sha: no job, company or CV text. Owner only (a 404 otherwise). Guard: test/search-lab.test.js.
import {viewer} from './auth.js';
import {esc, remember} from './stats.js';
import {judge, TIME_NAMES} from './search-lab-judge.js';
import {runs} from './search-lab-store.js';
import {draws} from './search-lab-draws.js';
import {DRAWS_CSS, drawsSection} from './search-lab-draws-page.js';
import {VISUALS_CSS, cards, statsStrip, tiles as visualTiles} from './search-lab-visuals.js';
import {historySection} from './search-lab-history.js';
import {realRows, realSection} from './search-lab-real.js';
import {experimentsSection} from './search-lab-experiments.js';
import {needsSection, fixedSection} from './search-lab-fixes.js';

const STATES = {failed: ['FAILED', 'bad'], stale: ['No valid replay', 'wait'], worse: ['Worse', 'bad'], new: ['New', 'wait'], working: ['Working', 'good']};
// A stale tape is no result (owner, 19 Oct 2026: judge the search live; a replay that asks what its recording lacks shows no seconds and no counts).
export const STALE_TEXT = 'No valid replay (replay parked)';
const num = value => (value == null ? '–' : Number(value).toLocaleString('en-US'));
// Under a minute in seconds, then m:ss; a time never reached says so.
export const clock = value => (value == null ? 'not reached' : value < 60 ? `${value} s` : `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`);
// A number and, when the last green run differed, how it moved (▲ better, ▼ worse; times are better when lower).
const cell = (row, field, show, lowerIsBetter) => {
  const value = row.now[field], before = row.base?.[field];
  if (!row.base || before === value) return show(value);
  const better = value == null ? false : before == null ? true : lowerIsBetter ? value < before : value > before;
  return `${show(value)} <span class="${better ? 'up' : 'down'}" title="last green run: ${esc(show(before))}">${better ? '▲' : '▼'}</span>`;
};

export function table(rows) {
  const body = rows.map(row => {
    const [word, tone] = STATES[row.state], failed = row.state === 'failed';
    if (row.state === 'stale') return `<tr><td><b>${esc(row.label)}</b>${row.control ? ' <span class="chip">control</span>' : ''}</td><td><span class="state ${tone}">${word}</span></td><td colspan="4" class="muted">${STALE_TEXT}</td></tr>`;
    return `<tr><td><b>${esc(row.label)}</b>${row.control ? ' <span class="chip">control</span>' : ''}</td>
<td><span class="state ${tone}">${word}</span>${row.why.length ? `<div class="why">${row.why.map(esc).join('<br>')}</div>` : ''}</td>
<td class="num">${failed ? '–' : cell(row, 'first_s', clock, true)}</td><td class="num">${failed ? '–' : cell(row, 'tenth_s', clock, true)}</td><td class="num">${failed ? '–' : cell(row, 'fit_s', clock, true)}</td>
<td class="num">${failed ? '–' : `${cell(row, 'in_places', num)} · ${num(row.now.scored)} · ${cell(row, 'fit70', num)}`}</td></tr>`;
  }).join('') || '<tr><td colspan="6" class="muted">No search replayed yet. Upload the persona harness\'s presses with <code>node tools/persona-search/lab-upload.mjs &lt;out&gt;</code> (REPLAYS_PUBLISH_KEY set).</td></tr>';
  return `<div class="scroll"><table><tr><th>Candidate</th><th>State</th><th class="num">${TIME_NAMES.first_s}</th><th class="num">${TIME_NAMES.tenth_s}</th><th class="num">${TIME_NAMES.fit_s}</th><th class="num">In places · scored · 70+</th></tr>${body}</table></div>`;
}

const CSS = `.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:16px}.tile b{display:block;font-size:28px;margin:4px 0}
.scroll{overflow-x:auto}.state{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}
.state.good{background:#16341f;color:#6fdc8c}.state.bad{background:#40181a;color:#ff8a80}.state.wait{background:#262c33;color:#b9c0c7}
.why{color:#8d949c;font-size:12px;margin-top:4px}.chip{display:inline-block;border:1px solid #2a2f37;border-radius:999px;padding:1px 9px;font-size:12px;color:#8d949c}
.tabs a.parked{opacity:.55}.tabs a.parked:first-of-type{margin-left:auto}.up{color:#6fdc8c}.down{color:#ff8a80}h2{margin:0 0 8px}td.num span{font-size:11px}`;

export function page(all, drawRows = [], tab = 'lab', real = []) {
  const rows = judge(all), newest = all.reduce((top, row) => (!top || row.run_at > top.run_at ? row : top), null);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Lab Job Search · Admin</title>
<link rel="icon" href="/favicon-32.png"><style>${CSS}${DRAWS_CSS}${VISUALS_CSS}</style></head><body><main>
<header><h1>🔬 Lab Job Search</h1><span class="muted">fictional candidates and real installs · counts and seconds only</span></header>
<nav class="tabs"><a href="?tab=real" class="${tab === 'real' ? 'on' : ''}">Real installs</a><a href="?tab=draws" class="${tab === 'draws' ? 'on' : ''}">Random draws</a><a href="?tab=experiments" class="${tab === 'experiments' ? 'on' : ''}">Experiments</a><a href="?tab=lab" class="${tab === 'lab' ? 'on' : ''} parked">Replays</a><a href="?tab=needs" class="${tab === 'needs' ? 'on' : ''} parked">Needs a fix</a><a href="?tab=fixed" class="${tab === 'fixed' ? 'on' : ''} parked">Fixed</a><a href="?tab=history" class="${tab === 'history' ? 'on' : ''} parked">History</a></nav>
${tab === 'needs' ? needsSection(all) : tab === 'fixed' ? fixedSection(all) : tab === 'experiments' ? experimentsSection() : tab === 'draws' ? drawsSection(drawRows) : tab === 'real' ? realSection(real, rows) : tab === 'history' ? historySection(all) : `${visualTiles(rows, newest)}${statsStrip(rows, all)}${cards(rows, all)}
<section class="card"><h2>Each candidate's newest search</h2>${table(rows)}</section>
<section class="card"><h2>How a row is judged</h2><p class="muted">Against the candidate's last green run: <b>Worse</b> when jobs in your places or jobs scoring 70+ are fewer, a time is more than 25 % slower, or a time that was reached is not reached (the control gets no tolerance on times). <b>FAILED</b> when a step of the search crashed: its numbers are never shown as a result. <b>No valid replay</b> when the build asks for pages or answers the tape never recorded (a change to what the search requests): no numbers are shown for it. The replay is parked (19 Oct 2026): judge the search by Real installs and Random draws. ▲ / ▼ show the move since the last green run.</p></section>`}
</main></body></html>`;
}

export async function view(request, env) {
  if (!await viewer(request, env)) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  if (url.searchParams.has('key')) return remember(url, env, request);
  let all = [];
  const tab = ['lab', 'draws', 'history', 'real', 'experiments', 'needs', 'fixed'].includes(url.searchParams.get('tab')) ? url.searchParams.get('tab') : 'real';
  let drawRows = [];
  try { all = env.STATS ? await runs(env.STATS) : []; } catch { all = []; }
  try { drawRows = env.STATS && tab === 'draws' ? await draws(env.STATS) : []; } catch { drawRows = []; }
  let real = [];
  try { real = env.STATS && tab === 'real' ? await realRows(env.STATS) : []; } catch { real = []; }
  return new Response(page(all, drawRows, tab, real), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});
}
