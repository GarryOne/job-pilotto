// The horizontal stacked bar rows of the admin pages (owner, 16 Oct 2026): one row per day, coloured segments with the count inside, a summary on the right, a legend of pills on top.
// The pool results chart (src/applying-nights.js, drawn in the browser) and the Overview (src/ops-overview.js, drawn here) share these class names and this CSS; change the look here only. Guard: test/ops-overview.test.js
import {esc} from './stats.js';

export const BARS_CSS = `.pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600;color:#0b0d10}
.nights{margin-top:24px;padding-top:18px}.nights .key{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px}.night{display:grid;grid-template-columns:56px minmax(0,1fr) 240px;gap:12px;align-items:center;margin:6px 0}
.nightbar{display:flex;gap:2px;height:28px;border-radius:7px;overflow:hidden}.nightbar i{display:flex;align-items:center;justify-content:center;min-width:0;font-style:normal;font-size:12px;font-weight:600;color:#0b0d10;overflow:hidden}
.nightbar i.thin{font-size:0}
@media (max-width:640px){.night{grid-template-columns:44px minmax(0,1fr)}.night>span{grid-column:2}}`;

const THIN = 0.06;   // a segment under 6% of its row shows its count on hover only

// segments: [{id, label, color}] in stack order; rows: [{label, title, counts: {id: n}}]; summary(row, total) → the right-hand text.
export function legend(segments) {
  return `<div class="key">${segments.map(s => `<span class="pill" style="background:${esc(s.color)}">${esc(s.label)}</span>`).join('')}</div>`;
}
export function barRows(segments, rows, summary) {
  return rows.map(row => {
    const total = segments.reduce((sum, s) => sum + (row.counts[s.id] || 0), 0);
    const parts = segments.filter(s => row.counts[s.id]).map(s => { const n = row.counts[s.id];
      return `<i${n / total < THIN ? ' class="thin"' : ''} style="flex:${n} 1 0;background:${esc(s.color)}" title="${esc(s.label)}: ${n} of ${total}">${n}</i>`; }).join('');
    return `<div class="night"><b title="${esc(row.title || row.label)}">${esc(row.label)}</b><div class="nightbar">${parts}</div><span class="muted">${esc(summary(row, total))}</span></div>`;
  }).join('');
}
