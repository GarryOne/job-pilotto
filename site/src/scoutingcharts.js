// Small server-drawn charts for /admin/scouting (owner, 19 Oct 2026: "It's too much of raw numbers/text/tables"): sparklines, a heat-map
// colour scale, horizontal bars, columns and one hover tooltip. Plain SVG/HTML strings on the admin's dark surface; no library, no data
// beyond what the caller passes. Tests: site/test/scoutingcharts.test.js.

export const esc = value => String(value ?? '').replace(/[&<>"]/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[ch]));
export const n = value => Number(value || 0).toLocaleString('en-US');

// The palette (dataviz reference, dark mode): one blue for magnitude, gray for what recedes, status colours only with a label.
export const C = {accent: '#3987e5', gray: '#5b636c', faint: '#2b3139', ink: '#f4efe3', muted: '#8d949c', good: '#0ca30c', warn: '#fab219', critical: '#d03b3b', surface: '#14181d'};
// Employers in a kind × country cell → a step of the sequential blue ramp; 25 (the floor) is where it turns bright.
export const STEPS = [[0, '#1b2027'], [1, '#104281'], [5, '#184f95'], [10, '#1c5cab'], [25, '#3987e5'], [50, '#6da7ec'], [100, '#b7d3f6']];
export const shade = value => STEPS.filter(([from]) => value >= from).pop()[1];
export const inkOn = value => (value >= 50 ? '#0b0d10' : value ? '#f4efe3' : '#5b636c');

const tip = text => (text ? ` data-tip="${esc(text)}"` : '');

// A trend as a 2px line with its last point marked; one point is a dot, none an empty box.
export function sparkline(values, {width = 120, height = 32, color = C.accent, label = ''} = {}) {
  const points = values.filter(value => Number.isFinite(value));
  if (!points.length) return `<svg class="spark" width="${width}" height="${height}" role="img" aria-label="${esc(label)}: no history yet"></svg>`;
  const lo = Math.min(...points), hi = Math.max(...points), span = hi - lo || 1;
  const x = i => (points.length === 1 ? width - 4 : 3 + (i * (width - 7)) / (points.length - 1));
  const y = value => height - 4 - ((value - lo) / span) * (height - 8);
  const path = points.map((value, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(value).toFixed(1)}`).join('');
  const last = points.length - 1;
  return `<svg class="spark" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}: ${n(points[0])} → ${n(points[last])}">`
    + (points.length > 1 ? `<path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` : '')
    + `<circle cx="${x(last).toFixed(1)}" cy="${y(points[last]).toFixed(1)}" r="3.5" fill="${color}" stroke="${C.surface}" stroke-width="2"/></svg>`;
}

// A tile: the big number, what it is, a sparkline under it and an optional delta (▲ good / ▼ bad, never colour alone).
export function tile(label, value, {spark = [], delta = null, note = ''} = {}) {
  const arrow = delta == null || delta === 0 ? '' : `<span class="delta ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '▲' : '▼'} ${n(Math.abs(delta))}</span>`;
  return `<div class="tile"><span class="tile-label">${esc(label)}</span><b>${value}</b>${arrow}${sparkline(spark, {width: 150, height: 30, label})}`
    + `${note ? `<small class="muted">${esc(note)}</small>` : ''}</div>`;
}

// Horizontal bars: [{label, parts: [[value, colour, name]], tip, after}] on one scale, the label on the left, the total on the right.
export function bars(items, {max = null, empty = 'Nothing yet.', unit = ''} = {}) {
  if (!items.length) return `<p class="muted empty">${esc(empty)}</p>`;
  const top = max || Math.max(1, ...items.map(item => item.parts.reduce((sum, [value]) => sum + value, 0)));
  return `<div class="bars">${items.map(item => {
    const total = item.parts.reduce((sum, [value]) => sum + value, 0);
    const parts = item.parts.filter(([value]) => value > 0).map(([value, colour, name]) => `<i style="width:${((100 * value) / top).toFixed(2)}%;background:${colour}"${tip(`${item.label} · ${name}: ${n(value)}${unit}`)}></i>`).join('');
    return `<div class="bar-row"${tip(item.tip)}><span class="bar-label">${esc(item.label)}</span><span class="bar-track">${parts}</span><span class="bar-value">${item.after ?? `${n(total)}${unit}`}</span></div>`;
  }).join('')}</div>`;
}

// Columns over time: [{value, tip}] oldest first, one colour; the tallest is labelled, the rest speak on hover.
export function columns(items, {height = 90, color = C.accent, label = '', empty = 'No runs recorded yet.'} = {}) {
  if (!items.length) return `<p class="muted empty">${esc(empty)}</p>`;
  const top = Math.max(1, ...items.map(item => item.value));
  const width = Math.max(240, items.length * 12), w = width / items.length;
  const cols = items.map((item, i) => {
    const h = Math.max(item.value ? 3 : 1, ((height - 14) * item.value) / top);
    return `<g${tip(item.tip)}><rect x="${(i * w).toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${height}" fill="transparent"/>`
      + `<rect x="${(i * w + 1).toFixed(1)}" y="${(height - h).toFixed(1)}" width="${Math.max(2, w - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(4, (w - 2) / 2).toFixed(1)}" fill="${item.value ? color : C.faint}"/></g>`;
  }).join('');
  return `<svg class="cols" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}: highest ${n(top)}">${cols}</svg>`;
}

// One floating tooltip for every [data-tip] on the page (cells, bars, columns); keyboard focus shows it too.
export const TOOLTIP = `<div id="tip" role="tooltip" hidden></div><script>
(() => { const box = document.getElementById('tip');
  const show = (el, x, y) => { box.textContent = el.dataset.tip; box.hidden = false; const r = box.getBoundingClientRect();
    box.style.left = Math.max(8, Math.min(innerWidth - r.width - 8, x + 12)) + 'px'; box.style.top = Math.max(8, y - r.height - 12) + 'px'; };
  document.addEventListener('mousemove', e => { const el = e.target.closest('[data-tip]'); el ? show(el, e.clientX, e.clientY) : (box.hidden = true); });
  document.addEventListener('focusin', e => { const el = e.target.closest('[data-tip]'); if (el) { const r = el.getBoundingClientRect(); show(el, r.left, r.top); } });
  document.addEventListener('focusout', () => { box.hidden = true; });
})();</script>`;

export const CHART_STYLE = `
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:12px}
.tile{background:#14181d;border:1px solid #262c33;border-radius:14px;padding:12px 14px;display:flex;flex-direction:column;gap:3px;min-width:0}
.tile b{font-size:26px;line-height:1.1;font-variant-numeric:tabular-nums}.tile-label{color:#8d949c;font-size:13px}.spark{display:block;margin-top:4px;max-width:100%}
.delta{font-size:12px;font-weight:600}.delta.up{color:#5fd35f}.delta.down{color:#ef8a8a}
.bars{display:flex;flex-direction:column;gap:6px}.bar-row{display:grid;grid-template-columns:minmax(90px,210px) 1fr auto;gap:8px;align-items:center;font-size:13px}
.bar-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#c9c3b6}.bar-track{display:flex;gap:2px;height:14px}
.bar-track i{display:block;height:100%;border-radius:0 4px 4px 0;min-width:2px}.bar-value{font-variant-numeric:tabular-nums;color:#c9c3b6;min-width:42px;text-align:right}
.cols{display:block;width:100%;height:90px}.empty{margin:6px 0}
.heat{border-collapse:separate;border-spacing:2px;font-size:12px;font-variant-numeric:tabular-nums;width:100%}
.heat th{font-weight:500;color:#8d949c;padding:2px 3px;text-align:center}.heat th.kind{text-align:left;white-space:nowrap;padding-right:8px}
.heat td{height:26px;min-width:24px;text-align:center;border-radius:4px;padding:0 2px;cursor:default}.heat td.aimed{box-shadow:inset 0 0 0 2px #fab219}
.heat td.total{background:none;text-align:right;color:#c9c3b6;padding-left:8px;white-space:nowrap}
.legend{display:flex;gap:4px;align-items:center;flex-wrap:wrap;font-size:12px;color:#8d949c;margin:8px 0 0}.legend i{display:inline-block;width:22px;height:12px;border-radius:3px}
.legend .ring{box-shadow:inset 0 0 0 2px #fab219;background:#1b2027}.legend .gap{margin-left:12px}
.multiples{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.multiple{background:#101418;border:1px solid #20262d;border-radius:10px;padding:8px 10px}.multiple b{font-size:18px}.multiple small{display:block;color:#8d949c}
details.fold{margin-bottom:8px}details.fold>summary{cursor:pointer;padding:10px 14px;background:#14181d;border:1px solid #262c33;border-radius:12px;list-style:none;font-weight:600}
details.fold>summary::before{content:'▸ ';color:#8d949c}details.fold[open]>summary::before{content:'▾ '}details.fold>.card{margin-top:6px}
#tip{position:fixed;z-index:9;pointer-events:none;background:#f4efe3;color:#0b0d10;font-size:12px;padding:5px 8px;border-radius:6px;max-width:320px;box-shadow:0 4px 14px #0008}
`;
