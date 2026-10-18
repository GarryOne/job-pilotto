// The "Random draws" tab of /admin/lab-job-search (owner, 18 Oct 2026): one report row per daily CI draw, newest first, and the trend of jobs in places per draw (red = weak).
// Counts and seconds only (src/search-lab-draws.js); every row says CI, so a Mac run is never compared with it. Guard: test/search-lab-draws.test.js.
import {esc} from './stats.js';
import {TIME_NAMES} from './search-lab-judge.js';
import {judge} from './search-lab-draws.js';

const TONE = {usual: ['Usual', 'good'], weak: ['Weak', 'bad'], failed: ['FAILED', 'bad']};
const num = value => (value == null ? '–' : Number(value).toLocaleString('en-US'));
const clock = value => (value == null ? 'not reached' : value < 60 ? `${value} s` : `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`);

export function trend(rows) {   // oldest left; bar height = jobs in places against the busiest draw shown
  const shown = rows.slice(0, 30).reverse(), top = Math.max(1, ...shown.map(row => row.in_places ?? 0));
  return `<div class="spark" aria-label="jobs in places per draw">${shown.map(row => `<i class="${row.verdict === 'usual' ? '' : 'weak'}" style="height:${Math.max(4, Math.round(100 * (row.in_places ?? 0) / top))}%" title="${esc(row.draw_date)}: ${num(row.in_places)}"></i>`).join('')}</div>`;
}

export function drawsSection(all) {
  const rows = judge(all), weak = rows.filter(row => row.verdict !== 'usual').length;
  const body = rows.map(row => {
    const [word, tone] = TONE[row.verdict], failed = row.verdict === 'failed';
    return `<tr><td>${esc(row.draw_date)}</td><td><b>${esc(row.family)}</b> · ${esc(row.city)}, ${esc(row.country)} <span class="chip">${esc((row.source || 'ci').toUpperCase())}</span></td>
<td><span class="state ${tone}">${word}</span>${row.why.length ? `<div class="why">${row.why.map(esc).join('<br>')}</div>` : ''}</td>
<td class="num">${failed ? '–' : clock(row.first_s)}</td><td class="num">${failed ? '–' : clock(row.tenth_s)}</td><td class="num">${failed ? '–' : clock(row.fit_s)}</td>
<td class="num">${failed ? '–' : `${num(row.in_places)} · ${num(row.scored)} · ${num(row.fit70)}`}</td></tr>`;
  }).join('') || '<tr><td colspan="7" class="muted">No draw yet. The daily CI job (.github/workflows/random-draw.yml) uploads one each day.</td></tr>';
  return `<section class="card"><h2>${rows.length} draws, ${weak} weak or failed</h2><div class="sparkwrap">${trend(rows)}<span class="muted">jobs in places per draw, last 30 (red = weak or failed)</span></div></section>
<section class="card"><h2>Each daily draw</h2><div class="scroll"><table><tr><th>Date</th><th>Draw</th><th>State</th><th class="num">${TIME_NAMES.first_s}</th><th class="num">${TIME_NAMES.tenth_s}</th><th class="num">${TIME_NAMES.fit_s}</th><th class="num">In places · scored · 70+</th></tr>${body}</table></div></section>
<section class="card"><h2>How a draw is judged</h2><p class="muted">A random role family in a random European city, a fictional CV, a fresh throwaway install on CI (data-centre address: a board that refuses is "not reached", never worked around). <b>Weak</b>: no relevant job reached, fewer than 10 jobs in places, or under half the role family's median once it has 5 earlier draws. Never mixed with the six candidates or the Real installs.</p></section>`;
}

export const DRAWS_CSS = `.spark{display:flex;align-items:flex-end;gap:3px;height:56px}.spark i{display:block;flex:1;background:#5fb3ff;opacity:.75;border-radius:2px 2px 0 0}.spark i.weak{background:#ff8a80;opacity:1}
.sparkwrap{display:flex;flex-direction:column;gap:6px}.tabs{display:flex;gap:8px;margin-bottom:12px}.tabs a{padding:4px 12px;border:1px solid #2a2f37;border-radius:999px;color:#8d949c;text-decoration:none;font-size:13px}.tabs a.on{color:#e6e9ed;border-color:#5fb3ff}`;
