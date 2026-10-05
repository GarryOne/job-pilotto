// How the Finder is evolving, as charts (5 Oct 2026): what it files each day and how each filing ended, how often it is right (a three-day rolling precision), what its AI costs, with the
// dates its rules changed marked on the line. Inline SVG from the daily history the stats build (desktop/e2e/lib/selfheal-stats.mjs dailyHistory): no library, and a table view of the same
// numbers. Colours follow the entity, never the rank: blue = a real bug, orange = a false positive or a test mistake, aqua = stale or duplicate; "not judged yet" is a hatch, not a colour
// (the three colours were validated on this surface for colour-blind readers). Pure: every function returns a string.
import {esc} from './stats.js';

export const MILESTONES = [
  {day: '2026-10-02', label: 'The Finder starts filing issues'},
  {day: '2026-10-03', label: 'The owner\'s severity rubric and the job-seeker test'},
  {day: '2026-10-04', label: 'One issue per defect family, a weekly self-review, and the recalibration (the stats cutoff)'},
  {day: '2026-10-05', label: 'Findings are judged before an issue opens'},
  {day: '2026-10-05', label: 'Stale hold, resolution labels and replay data on every issue'},
  {day: '2026-10-05', label: 'Detector breaker, learned mistakes and the judge exam'},
];

const W = 760, H = 230, M = {l: 40, r: 14, t: 22, b: 30};
const PLOT = {w: W - M.l - M.r, h: H - M.t - M.b};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dayLabel = day => `${Number(day.slice(8))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
export const niceMax = value => (value <= 5 ? 5 : value <= 20 ? Math.ceil(value / 5) * 5 : value <= 50 ? Math.ceil(value / 10) * 10 : Math.ceil(value / 20) * 20);
const usd = value => (value < 1 ? `$${value.toFixed(2)}` : `$${value.toFixed(value < 10 ? 2 : 1)}`);

// The precision of the three days up to and including each one: real / (real + false). A day with no judged finding has no rate of its own; the rolling one may still have.
export function precisionSeries(history, window = 3) {
  return history.map((row, index) => {
    const span = history.slice(Math.max(0, index - window + 1), index + 1);
    const real = span.reduce((sum, item) => sum + item.real, 0), wrong = span.reduce((sum, item) => sum + item.falsePositive, 0);
    const own = row.real + row.falsePositive;
    return {day: row.day, judged: own, real: row.real, wrong: row.falsePositive, own: own ? Math.round(100 * row.real / own) : null, rolling: real + wrong ? Math.round(100 * real / (real + wrong)) : null, rollingJudged: real + wrong};
  });
}

const xOf = (index, count) => M.l + (PLOT.w / Math.max(count, 1)) * (index + 0.5);
const stepOf = count => PLOT.w / Math.max(count, 1);
// A bar's top segment has its two data-end corners rounded (4 px) and sits on the baseline; the others are square.
const roundedTop = (x, y, w, h, r) => { const k = Math.min(r, h, w / 2); return `M${x},${y + h}V${y + k}Q${x},${y} ${x + k},${y}H${x + w - k}Q${x + w},${y} ${x + w},${y + k}V${y + h}Z`; };
const axis = (max, ticks, format = value => value) => {
  const lines = [];
  for (const tick of ticks) { const y = M.t + PLOT.h * (1 - tick / max); lines.push(`<line class="grid" x1="${M.l}" x2="${W - M.r}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/><text class="tick" x="${M.l - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end">${esc(format(tick))}</text>`); }
  return lines.join('');
};
const xLabels = history => {
  const every = history.length > 16 ? 2 : 1;
  return history.map((row, index) => (index % every === 0 ? `<text class="tick" x="${xOf(index, history.length).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(dayLabel(row.day))}</text>` : '')).join('');
};
const hit = (index, count, tip) => `<rect class="hit" x="${(M.l + stepOf(count) * index).toFixed(1)}" y="${M.t}" width="${stepOf(count).toFixed(1)}" height="${PLOT.h}" fill="transparent" tabindex="0" data-tip="${esc(tip)}"/>`;

// ---------- 1. what it files each day, and how each ended ----------
export function filedChart(history) {
  const max = niceMax(Math.max(1, ...history.map(row => row.filed)));
  const ticks = [0, Math.round(max / 2), max].filter((tick, at, all) => all.indexOf(tick) === at);
  const barW = Math.min(30, stepOf(history.length) * 0.6);
  const parts = [axis(max, ticks), xLabels(history)];
  history.forEach((row, index) => {
    const x = xOf(index, history.length) - barW / 2;
    let y = M.t + PLOT.h;
    const stack = [['s-real', row.real], ['s-false', row.falsePositive], ['s-stale', row.stale], ['s-open', row.open]].filter(([, value]) => value > 0);
    stack.forEach(([cls, value], at) => {
      const h = (PLOT.h * value) / max;
      y -= h;
      parts.push(at === stack.length - 1 ? `<path class="${cls}" d="${roundedTop(x, y, barW, h, 4)}"/>` : `<rect class="${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}"/>`);
    });
    if (row.filed) parts.push(`<text class="value" x="${xOf(index, history.length).toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle">${row.filed}</text>`);
    const judged = row.real + row.falsePositive;
    parts.push(hit(index, history.length, `${dayLabel(row.day)}: ${row.filed} filed — ${row.real} real, ${row.falsePositive} false, ${row.stale} stale or duplicate, ${row.open} not judged yet${judged ? ` (${Math.round(100 * row.real / judged)}% right)` : ''}`));
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Issues filed per day, by how they ended"><defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" class="hatch-bg"/><line x1="0" y1="0" x2="0" y2="6" class="hatch-line"/></pattern></defs>${parts.join('')}</svg>`;
}

// ---------- 2. how often it is right, with the dates its rules changed ----------
export function precisionChart(history, milestones = MILESTONES) {
  const series = precisionSeries(history), count = history.length, y = rate => M.t + PLOT.h * (1 - rate / 100);
  const parts = [axis(100, [0, 25, 50, 75, 100], value => `${value}%`), xLabels(history)];
  // the dates the rules changed: a dashed line and a numbered marker; several on one day stack their markers
  const stacked = {};
  milestones.forEach((item, at) => {
    const index = history.findIndex(row => row.day === item.day);
    if (index < 0) return;
    const level = (stacked[item.day] = (stacked[item.day] ?? -1) + 1), x = xOf(index, count), cy = M.t - 8 + level * 18 + 12;
    if (level === 0) parts.push(`<line class="mark-line" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${M.t}" y2="${M.t + PLOT.h}"/>`);
    parts.push(`<g class="milestone"><circle cx="${x.toFixed(1)}" cy="${cy}" r="8"/><text x="${x.toFixed(1)}" y="${cy + 3.5}" text-anchor="middle">${at + 1}</text></g>`);
  });
  const points = series.map((row, index) => (row.rolling === null ? null : [xOf(index, count), y(row.rolling)]));
  const path = points.filter(Boolean).map(([px, py], at) => `${at ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
  if (path) parts.push(`<path class="line" d="${path}"/>`);
  series.forEach((row, index) => {
    if (row.own !== null) parts.push(`<circle class="dot" cx="${xOf(index, count).toFixed(1)}" cy="${y(row.own).toFixed(1)}" r="4.5"/>`);
  });
  const last = [...series.keys()].reverse().find(index => series[index].rolling !== null);
  if (last !== undefined) parts.push(`<text class="value" x="${(xOf(last, count) + 8).toFixed(1)}" y="${(y(series[last].rolling) + 4).toFixed(1)}" text-anchor="start">${series[last].rolling}%</text>`);
  series.forEach((row, index) => parts.push(hit(index, count, `${dayLabel(row.day)}: ${row.own === null ? 'nothing judged that day' : `${row.own}% right (${row.real} real of ${row.judged} judged)`}${row.rolling === null ? '' : `; the last three days ${row.rolling}% (${row.rollingJudged} judged)`}`)));
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="How often the Finder is right, per day and over three days">${parts.join('')}</svg>`;
}

// ---------- 3. what its AI costs each day ----------
export function costChart(history, costDays = {}) {
  const values = history.map(row => costDays[row.day] || 0);
  if (!values.some(Boolean)) return '';
  const max = niceMax(Math.max(...values)), count = history.length, barW = Math.min(30, stepOf(count) * 0.6);
  const parts = [axis(max, [0, Math.round(max / 2), max].filter((tick, at, all) => all.indexOf(tick) === at), usd), xLabels(history)];
  values.forEach((value, index) => {
    const h = (PLOT.h * value) / max, x = xOf(index, count) - barW / 2, top = M.t + PLOT.h - h;
    if (value) parts.push(`<path class="s-real" d="${roundedTop(x, top, barW, h, 4)}"/><text class="value" x="${xOf(index, count).toFixed(1)}" y="${(top - 6).toFixed(1)}" text-anchor="middle">${esc(usd(value))}</text>`);
    parts.push(hit(index, count, `${dayLabel(history[index].day)}: ${usd(value)} of AI cost`));
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="AI cost per day">${parts.join('')}</svg>`;
}

const legend = () => `<ul class="legend"><li><i class="sw s-real"></i>Real bug</li><li><i class="sw s-false"></i>False positive or test mistake</li><li><i class="sw s-stale"></i>Stale or duplicate</li><li><i class="sw s-open"></i>Not judged yet</li></ul>`;

// The same numbers as a table: the chart is never the only way to read them.
export function trendTable(history, costDays = {}) {
  const series = precisionSeries(history);
  return `<details class="tv"><summary>Table view</summary><div class="wrap"><table><tr><th>Day</th><th>Filed</th><th>Real</th><th>False</th><th>Stale or dup.</th><th>Not judged</th><th>Right</th><th>AI cost</th></tr>
${history.map((row, index) => `<tr><td>${esc(dayLabel(row.day))}</td><td class="n">${row.filed}</td><td class="n">${row.real}</td><td class="n">${row.falsePositive}</td><td class="n">${row.stale}</td><td class="n">${row.open}</td><td class="n">${series[index].own === null ? '–' : `${series[index].own}%`}</td><td class="n">${costDays[row.day] ? esc(usd(costDays[row.day])) : '–'}</td></tr>`).join('')}</table></div></details>`;
}

export function trendSection(live) {
  const history = Array.isArray(live.history) ? live.history : [];
  if (!history.length) return `<section class="card"><h2>📈 How the Finder is evolving</h2><p class="muted">No daily history yet: it arrives with the next publish.</p></section>`;
  const costs = costChart(history, live.costDays || {});
  return `<section class="card"><h2>📈 How the Finder is evolving</h2><small class="muted">Every issue it filed, by the day it was filed and how it ended (not cut at the stats cutoff, so the first days are the noisy ones). Hover or focus a day for its numbers.</small>
<h3>What it files each day, and how each ended</h3>${legend()}${filedChart(history)}
<h3>How often it is right</h3><small class="muted">Dots: each day (real ÷ judged). Line: the last three days together. Numbered markers: the dates its rules changed.</small>${precisionChart(history)}
<ol class="milestones">${MILESTONES.map(item => `<li><b>${esc(dayLabel(item.day))}</b> · ${esc(item.label)}</li>`).join('')}</ol>
${costs ? `<h3>What its AI costs each day</h3>${costs}` : ''}${trendTable(history, live.costDays || {})}</section>`;
}

// The hover layer: a tooltip for the mark under the pointer or the keyboard focus (data-tip on a hit area larger than the mark).
export const TREND_STYLE = `.chart{width:100%;height:auto;display:block;margin:6px 0 4px}.chart .grid{stroke:var(--line);stroke-width:1}.chart .tick{fill:var(--muted);font-size:11px}.chart .value{fill:var(--text);font-size:11px;font-variant-numeric:tabular-nums}
.s-real{fill:var(--s1)}.s-false{fill:var(--s2)}.s-stale{fill:var(--s3)}.s-open{fill:url(#hatch)}.chart .s-real,.chart .s-false,.chart .s-stale,.chart .s-open{stroke:var(--card);stroke-width:2}.chart .hit{stroke:none}.chart .hit:hover,.chart .hit:focus{fill:rgba(255,255,255,.06);outline:none}
.hatch-bg{fill:var(--card)}.hatch-line{stroke:var(--muted);stroke-width:2}.chart .line{fill:none;stroke:var(--s1);stroke-width:2;stroke-linejoin:round}.chart .dot{fill:var(--card);stroke:var(--s1);stroke-width:2}
.chart .mark-line{stroke:var(--muted);stroke-width:1;stroke-dasharray:3 3}.chart .milestone circle{fill:var(--card);stroke:var(--muted);stroke-width:1.5}.chart .milestone text{fill:var(--text);font-size:10px;font-weight:600}
.legend{display:flex;flex-wrap:wrap;gap:14px;list-style:none;margin:8px 0 0;padding:0;font-size:12px;color:var(--muted)}.legend li{display:flex;align-items:center;gap:6px}.sw{width:10px;height:10px;border-radius:2px;display:inline-block}.sw.s-open{background:repeating-linear-gradient(45deg,var(--muted) 0 2px,var(--card) 2px 5px)}.sw.s-real{background:var(--s1)}.sw.s-false{background:var(--s2)}.sw.s-stale{background:var(--s3)}
h3{font-size:13px;margin:16px 0 0;color:var(--text)}.milestones{margin:6px 0 0;padding-left:20px;font-size:12px;color:var(--muted)}.tv{margin-top:12px}.tv summary{cursor:pointer;color:var(--muted);font-size:12px}
#tip{position:fixed;z-index:9;pointer-events:none;background:#000;color:var(--text);border:1px solid var(--line);border-radius:8px;padding:6px 9px;font-size:12px;max-width:320px;box-shadow:0 4px 14px rgba(0,0,0,.5)}`;
export const TREND_SCRIPT = `(function(){var tip=document.getElementById('tip');if(!tip)return;function show(el,x,y){tip.textContent=el.getAttribute('data-tip');tip.hidden=false;var w=tip.offsetWidth;tip.style.left=Math.min(Math.max(8,x+12),window.innerWidth-w-8)+'px';tip.style.top=Math.max(8,y-tip.offsetHeight-12)+'px'}
document.addEventListener('mousemove',function(e){var el=e.target.closest&&e.target.closest('[data-tip]');if(el)show(el,e.clientX,e.clientY);else tip.hidden=true});
document.addEventListener('focusin',function(e){var el=e.target.closest&&e.target.closest('[data-tip]');if(el){var r=el.getBoundingClientRect();show(el,r.left+r.width/2,r.top)}});document.addEventListener('focusout',function(){tip.hidden=true})})();`;
