// The Lab Job Search page's visual layer (owner, 18 Oct 2026: "add more colors, more nice graphs/widgets/bars... and put more information"): a health bar and coloured state tiles, one card per
// candidate (time-to-result bars on a shared scale, funnel meters, a history sparkline, build and last-green facts). Pure: rows in, HTML out; counts and seconds only, no job text.
// The exact numbers stay in the table (src/search-lab-page.js). Guard: test/search-lab.test.js.
import {esc} from './stats.js';
import {TIME_NAMES} from './search-lab-judge.js';

export const TONE_COLOR = {good: '#4cc38a', bad: '#ff6b6b', wait: '#f0b44c', info: '#5aa9ff', mute: '#6b7480'};
const STATE_TONE = {working: 'good', failed: 'bad', worse: 'bad', stale: 'wait', new: 'info'};
const WORDS = {working: 'Working', failed: 'FAILED', worse: 'Worse', stale: 'No valid replay', new: 'New'};
const fmt = value => (value == null ? '–' : Number(value).toLocaleString('en-US'));
const clock = value => (value == null ? 'not reached' : value < 60 ? `${value} s` : `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`);
const pct = (part, whole) => (whole ? Math.round((100 * part) / whole) : 0);
const when = iso => (iso ? `${iso.slice(5, 10)} ${iso.slice(11, 16)} UTC` : '–');

// A tiny line of values, oldest first: a dot when there is only one run.
export function spark(values, color, width = 132, height = 32) {
  const list = values.filter(value => value != null);
  if (!list.length) return `<svg class="lv-spark" width="${width}" height="${height}" role="img" aria-label="no runs"></svg>`;
  const lo = Math.min(...list), hi = Math.max(...list), span = hi - lo || 1, step = list.length > 1 ? (width - 8) / (list.length - 1) : 0;
  const point = (value, index) => [4 + index * step, height - 4 - ((value - lo) / span) * (height - 8)];
  const dots = list.map(point), last = dots.at(-1);
  const line = dots.length > 1 ? `<polyline fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" points="${dots.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}"/>` : '';
  return `<svg class="lv-spark" width="${width}" height="${height}" role="img" aria-label="${list.length} runs, now ${list.at(-1)}">${line}<circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3.5" fill="${color}"/></svg>`;
}

// One health bar: a segment per state, as wide as its share of the candidates.
export function healthBar(rows) {
  const states = ['working', 'new', 'stale', 'worse', 'failed'].map(state => [state, rows.filter(row => row.state === state).length]).filter(([, count]) => count);
  if (!states.length) return '';
  return `<div class="lv-health" role="img" aria-label="candidate states">${states.map(([state, count]) => `<i style="flex:${count};background:${TONE_COLOR[STATE_TONE[state]]}" title="${count} ${WORDS[state]}">${count} ${WORDS[state]}</i>`).join('')}</div>`;
}

// The headline tiles, each with the colour of what it counts.
export function tiles(rows, newest) {
  const count = state => rows.filter(row => row.state === state).length, fine = count('working') + count('new');
  const tile = (tone, label, big, note) => `<section class="card lv-tile" style="--tone:${TONE_COLOR[tone]}"><span class="muted">${label}</span><b>${big}</b><span class="muted">${note}</span></section>`;
  return `<div class="lv-tiles">${tile(fine === rows.length && rows.length ? 'good' : 'wait', 'Not worse than last green', `${fine} / ${rows.length}`, 'candidates replayed')}
${tile(count('worse') ? 'bad' : 'good', 'Worse', count('worse'), 'a count lower or a time over 25 % slower')}
${tile(count('failed') ? 'bad' : 'good', 'FAILED', count('failed'), 'a step crashed')}
${tile(count('stale') ? 'wait' : 'good', 'No valid replay', count('stale'), 'replay parked')}
${tile('info', 'Newest run', newest?.build ? esc(newest.build.slice(0, 7)) : '–', newest ? esc(when(newest.run_at)) : 'nothing replayed yet')}</div>${healthBar(rows)}`;
}

// The two lead tiles (owner, 18 Oct 2026): the median time to the first job and to the first 70+ job across the candidates, with the move against
// the last green run (▲ slower, ▼ faster) and the best and worst candidate.
export const median = list => { const sorted = list.filter(value => value != null).sort((a, b) => a - b); return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null; };
function timeTile(rows, field, icon) {
  const live = rows.filter(row => row.state !== 'failed' && row.now[field] != null), now = median(live.map(row => row.now[field]));
  const pairs = rows.filter(row => row.state !== 'failed' && row.base && row.now[field] != null && row.base[field] != null);
  const was = median(pairs.map(row => row.base[field])), is = median(pairs.map(row => row.now[field]));
  const move = was == null ? '<span class="muted">no earlier green run</span>' : is === was ? '<span class="muted">same as last green</span>' : `<span style="color:${TONE_COLOR[is > was ? 'bad' : 'good']}">${is > was ? '▲' : '▼'} ${Math.abs(is - was)} s ${is > was ? 'slower' : 'faster'} than last green</span>`;
  const sorted = [...live].sort((a, b) => a.now[field] - b.now[field]), best = sorted[0], worst = sorted.at(-1);
  const edge = best ? `best ${esc(best.label)} ${clock(best.now[field])} · worst ${esc(worst.label)} ${clock(worst.now[field])}` : 'no candidate reached it';
  return `<section class="card lv-tile lv-lead" style="--tone:${TONE_COLOR.info}"><span class="muted">${icon} ${TIME_NAMES[field]}</span><b>${clock(now)}</b><span>${move}</span><span class="muted">${edge}</span></section>`;
}
export const timeTiles = rows => (rows.length ? `<div class="lv-tiles lv-leads">${timeTile(rows, 'first_s', '⏱')}${timeTile(rows, 'fit_s', '⏱')}</div>` : '');

// The three times of one search as bars on a scale shared by every candidate, so a slow one stands out.
function timeBars(row, scale) {
  const bar = (name, value, tone) => {
    const width = value == null ? 100 : Math.max(2, Math.round((100 * value) / scale));
    return `<div class="lv-time"><span>${name}</span><div class="lv-track${value == null ? ' none' : ''}"><i style="width:${width}%;background:${TONE_COLOR[tone]}"></i></div><b>${clock(value)}</b></div>`;
  };
  return `${bar('First job', row.now.first_s, 'info')}${bar('10th job', row.now.tenth_s, 'info')}${bar('First 70+ job', row.now.fit_s, 'good')}`;
}

// A share of the stage before, as a meter: scored of the jobs in places, 70+ of the scored.
const meter = (name, part, whole, tone) => `<div class="lv-meter"><span>${name}</span><div class="lv-track"><i style="width:${Math.max(part ? 2 : 0, pct(part, whole))}%;background:${TONE_COLOR[tone]}"></i></div><b>${fmt(part)} of ${fmt(whole)} · ${pct(part, whole)} %</b></div>`;

// rows = judge(all); all = every kept run (the history). One card per candidate.
export function cards(rows, all) {
  if (!rows.length) return '';
  const reached = rows.flatMap(row => [row.now.first_s, row.now.tenth_s, row.now.fit_s]).filter(value => value != null);
  const scale = Math.max(60, ...reached);
  return `<div class="lv-cards">${rows.map(row => {
    const history = all.filter(item => item.candidate === row.now.candidate).sort((a, b) => a.run_at.localeCompare(b.run_at)).slice(-30);
    const tone = STATE_TONE[row.state], base = row.base, ok = row.state !== 'failed' && row.state !== 'stale';
    return `<section class="card lv-card" style="--tone:${TONE_COLOR[tone]}"><header><b>${esc(row.label)}</b>${row.control ? ' <span class="chip">control</span>' : ''}<span class="state ${tone === 'info' ? 'wait' : tone}">${WORDS[row.state]}</span></header>
${ok ? `<div class="lv-big"><div><b>${fmt(row.now.in_places)}</b><span class="muted">jobs in your places</span></div><div><b>${fmt(row.now.scored)}</b><span class="muted">scored</span></div><div><b style="color:${TONE_COLOR.good}">${fmt(row.now.fit70)}</b><span class="muted">scoring 70+</span></div></div>
<h3>Time to results</h3>${timeBars(row, scale)}<h3>Funnel</h3>${meter('Scored', row.now.scored ?? 0, row.now.in_places ?? 0, 'info')}${meter('70+', row.now.fit70 ?? 0, row.now.scored ?? 0, 'good')}
<h3>Across ${history.length} run${history.length === 1 ? '' : 's'}</h3><div class="lv-sparks"><div><span class="muted">in places</span>${spark(history.map(item => item.in_places), TONE_COLOR.info)}</div><div><span class="muted">70+</span>${spark(history.map(item => item.fit70), TONE_COLOR.good)}</div><div><span class="muted">${TIME_NAMES.first_s}, s</span>${spark(history.map(item => item.first_s), TONE_COLOR.wait)}</div></div>`
  : row.state === 'stale' ? '<p class="muted">No valid replay (replay parked)</p>' : `<p class="lv-crash">${esc(row.why[0] || 'a step crashed')}</p>`}
${row.why.length && ok ? `<div class="why">${row.why.map(esc).join('<br>')}</div>` : ''}
<footer class="muted"><span>build <code>${esc((row.now.build || '–').slice(0, 7))}</code> · ${esc(when(row.now.run_at))}</span><span>${base ? `last green <code>${esc((base.build || '–').slice(0, 7))}</code> · ${esc(when(base.run_at))}` : 'no green run yet'}</span></footer></section>`;
  }).join('')}</div>`;
}

// Numbers over the newest search of every candidate and over every kept run: the strip under the tiles.
export function statsStrip(rows, all) {
  const now = rows.filter(row => row.state !== 'stale').map(row => row.now), sum = field => now.reduce((total, item) => total + (item[field] || 0), 0);
  const okRuns = all.filter(run => run.state === 'ok').length, builds = new Set(all.map(run => run.build).filter(Boolean)).size;
  const stat = (name, value, note) => `<div class="lv-stat"><span class="muted">${name}</span><b>${value}</b><span class="muted">${note}</span></div>`;
  return `<section class="card lv-stats">${stat('Jobs in places', fmt(sum('in_places')), 'all candidates, newest run')}${stat('Scored', fmt(sum('scored')), `${pct(sum('scored'), sum('in_places'))} % of those`)}${stat('Scoring 70+', fmt(sum('fit70')), `${pct(sum('fit70'), sum('scored'))} % of scored`)}
${stat('Runs kept', fmt(all.length), `${okRuns} replayed, ${all.length - okRuns} not`)}${stat('Builds seen', fmt(builds), 'distinct commits')}${stat('Oldest kept run', when(all.reduce((top, run) => (!top || run.run_at < top ? run.run_at : top), '')), 'oldest kept run')}</section>`;
}

export const VISUALS_CSS = `.lv-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:12px}
.lv-tile{border-top:3px solid var(--tone)}.lv-tile b{display:block;font-size:30px;margin:4px 0;color:var(--tone)}
.lv-health{display:flex;gap:3px;height:30px;border-radius:9px;overflow:hidden;margin:0 0 16px}.lv-health i{display:flex;align-items:center;justify-content:center;font-style:normal;font-size:12px;font-weight:700;color:#0b0d10;min-width:0;overflow:hidden;white-space:nowrap}
.lv-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:12px;margin-bottom:16px}
.lv-lead span{display:block}.lv-lead b{font-size:44px}.lv-leads{grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
.lv-card{border-top:3px solid var(--tone);display:flex;flex-direction:column;gap:6px}.lv-card header{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.lv-card header .state{margin-left:auto}
.lv-card h3{margin:8px 0 2px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#8d949c}
.lv-big{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:4px}.lv-big b{display:block;font-size:24px}.lv-big span{font-size:12px}
.lv-time,.lv-meter{display:grid;grid-template-columns:96px minmax(0,1fr) auto;gap:8px;align-items:center;font-size:12px;margin:3px 0}.lv-meter{grid-template-columns:60px minmax(0,1fr) auto}
.lv-track{height:10px;border-radius:999px;background:#1b2027;overflow:hidden}.lv-track i{display:block;height:100%;border-radius:999px}.lv-track.none{background:repeating-linear-gradient(45deg,#262c33,#262c33 4px,#1b2027 4px,#1b2027 8px)}.lv-track.none i{display:none}
.lv-sparks{display:flex;gap:14px;flex-wrap:wrap}.lv-sparks>div{display:flex;flex-direction:column;gap:2px;font-size:12px}.lv-spark{display:block}
.lv-card footer{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:12px;margin-top:auto;padding-top:8px;border-top:1px solid #2a2f37}.lv-crash{color:#ff8a80}
.lv-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:16px}.lv-stat b{display:block;font-size:20px;margin:2px 0}.lv-stat span{font-size:12px}
.lv-hist td,.lv-hist th{white-space:nowrap}`;
