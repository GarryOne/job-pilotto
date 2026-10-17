// The page of /admin/benchmark-form-filling (owner, 15 Oct 2026): our extension against other tools on the same forms, read from ONE snapshot. Every tool, form and build name is data; none is written here.
// The tiles' colours are the shared rule (src/applying-tiles.js). The headline is user mode; harness mode and each applicant get their own view, never added together. Guard: test/benchmark.test.js.
import {esc} from './stats.js';
import {filterLinks, spark} from './admin.js';
import {countTone, shareTone} from './applying-tiles.js';
import {segmentKey} from './benchmark-data.js';
import {objectiveBlock} from './benchmark-objective.js';

const pct = value => (value == null ? '–' : `${value}%`);
const tone = value => shareTone(value);
const APPLICANT_WORDS = {thin: 'thin applicant', grown: 'grown applicant'};
const MODE_WORDS = {user: 'user mode', harness: 'harness mode', unknown: 'mode not recorded'};
export const segmentLabel = key => { const [applicant, mode] = key.split(':'); return `${APPLICANT_WORDS[applicant] || applicant} · ${MODE_WORDS[mode] || mode}`; };
// The view to show: the one asked for, else user mode with the thin applicant, else the first there is.
export const pickSegment = (snapshot, asked) => { const keys = Object.keys(snapshot?.segments || {}); return keys.includes(asked) ? asked : keys.includes(segmentKey('thin', 'user')) ? segmentKey('thin', 'user') : keys[0] || null; };

const CSS = `:root{--card:#14181d;--line:#262c33;--text:#f4efe3;--muted:#8d949c;--amber:#f5b54a;--green:#5ec47a;--red:#e5484d}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1px;margin:0 0 16px;background:var(--line);border:1px solid var(--line);border-radius:12px;overflow:hidden}
.tile{background:var(--card);padding:14px 16px}.tile b{display:block;font-size:28px;line-height:1.2}.tile .what{display:block;font-size:14px}.tile .note{display:block;margin-top:4px;color:var(--muted);font-size:12px}
.good{color:var(--green)}.warn{color:var(--amber)}.bad{color:var(--red)}.tile.good b,.tile.warn b,.tile.bad b{color:inherit}
td.cell{white-space:nowrap;text-align:center}td.cell .x{margin-left:6px;font-size:12px}tr.ours td:first-child{font-weight:700}
.checks{margin:0;padding-left:0;list-style:none}.checks li{padding:4px 0}.banner{border:1px solid var(--amber);color:var(--amber);border-radius:12px;padding:10px 14px;margin:0 0 16px;font-size:13px}.filters{margin:8px 0 14px}h2{margin:0 0 4px}details{margin-top:8px}`;

function tiles(view) {
  const ours = view.tools.find(tool => tool.ours), others = view.tools.filter(tool => !tool.ours), best = others[0];
  if (!ours) return '';
  const gap = best && ours.raw != null && best.raw != null ? ours.raw - best.raw : null;
  return `<div class="tiles">
<section class="tile ${tone(ours.raw)}"><b>${pct(ours.raw)}</b><span class="what">Raw score</span><span class="note">${ours.right} right of ${ours.required} required, over ${ours.forms} forms</span></section>
<section class="tile ${tone(ours.product)}"><b>${pct(ours.product)}</b><span class="what">Product score</span><span class="note">${ours.right} right of ${ours.countable} the facts answer, minus consent holds and duplicates</span></section>
<section class="tile"><b>${pct(ours.ceiling)}</b><span class="what">Ceiling</span><span class="note">the most this applicant's facts allow</span></section>
<section class="tile ${countTone(ours.wrong)}"><b>${ours.wrong}</b><span class="what">Wrong answers</span><span class="note">fields filled with something wrong (green at 0)</span></section>
<section class="tile"><b>${gap == null ? '–' : `${gap > 0 ? '+' : ''}${gap} pts`}</b><span class="what">Against the best other tool</span><span class="note">raw score, ours minus the best of the others</span></section></div>`;
}

function scoreboard(view) {
  const rows = view.tools.map(tool => `<tr class="${tool.ours ? 'ours' : ''}"><td>${esc(tool.tool)}${tool.ours && tool.build ? ` <span class="muted">build ${esc(tool.build)}</span>` : ''}</td><td class="num">${tool.forms}</td>
<td class="num good">${tool.right}</td><td class="num ${tool.wrong ? 'bad' : ''}">${tool.wrong}</td><td class="num">${tool.empty}</td>
<td class="num ${tone(tool.raw)}">${pct(tool.raw)}</td><td class="num ${tone(tool.product)}">${pct(tool.product)}</td><td class="num muted">${pct(tool.ceiling)}</td></tr>`).join('');
  return `<section class="card"><h2>Score per tool</h2><p class="muted">Required fields: right, wrong, left empty. Raw = right of all required; product leaves out what the facts cannot answer, consent holds and duplicates. The ceiling is the most the facts allow.</p>
<table><tr><th>Tool</th><th class="num">Forms</th><th class="num">Right</th><th class="num">Wrong</th><th class="num">Empty</th><th class="num">Raw</th><th class="num">Product</th><th class="num">Ceiling</th></tr>${rows}</table></section>`;
}

function grid(view) {
  const names = view.tools.map(tool => tool.tool);
  const cell = (tool, form) => {
    const c = view.grid[tool]?.[form];
    if (!c) return '<td class="cell muted">n/a</td>';
    return `<td class="cell ${tone(c.required ? Math.round(100 * c.right / c.required) : null)}">${c.right}/${c.required}${c.wrong ? `<span class="x bad" title="${c.wrong} wrong">✗${c.wrong}</span>` : ''}</td>`;
  };
  return `<section class="card"><h2>Per form</h2><p class="muted">Right of required, per form and tool. ✗ = wrong answers. Colours are the share right: green 70% or more, amber 50-69%, red under 50%.</p>
<table><tr><th>Form</th>${names.map(name => `<th class="cell">${esc(name)}</th>`).join('')}</tr>${view.forms.map(form => `<tr><td>${esc(form)}</td>${names.map(name => cell(name, form)).join('')}</tr>`).join('')}</table></section>`;
}

function trend(view) {
  const rows = [...view.trend].reverse().map(t => `<tr><td>${esc(t.build)}</td><td class="nowrap">${esc(t.at.slice(0, 10))}</td><td class="num">${t.forms}</td><td class="num ${tone(t.raw)}">${pct(t.raw)}</td><td class="num ${tone(t.product)}">${pct(t.product)}</td><td class="num ${t.wrong ? 'bad' : ''}">${t.wrong}</td><td class="num muted">${pct(t.ceiling)}</td></tr>`).join('');
  const chip = view.trend.length > 1 ? `<span class="trend">raw ${spark(view.trend.map(t => t.raw), {format: v => `${Math.round(v)}%`})}</span>` : '';
  return `<section class="card"><h2>Our extension, build by build</h2>${chip}<table><tr><th>Build</th><th>Date</th><th class="num">Forms</th><th class="num">Raw</th><th class="num">Product</th><th class="num">Wrong</th><th class="num">Ceiling</th></tr>${rows}</table></section>`;
}

const METHOD = `<section class="card"><details><summary>How this is measured</summary>
<ul><li>The same fixed forms for every tool; one fake applicant; nothing is ever submitted.</li>
<li>Each required field is judged right, wrong or empty by an AI judge reading the filled page; a field the facts cannot answer counts against nobody in the product score.</li>
<li>Thin and grown applicants, and user mode and harness mode, are separate views and are never added together.</li>
<li>User mode is what real users run; harness mode has the test harness's repair rung on and is not comparable.</li>
<li>Runs scored before a bake-off harness fix (the trail rule, the dropdown reader) are counted and named above; each old behaviour hit every tool alike, so older scores can be off in level more than in ranking.</li>
<li>A required upload the harness's safety guard stopped (the page posts to its own upload address first, and the guard refuses every write to the form site) counts as a hold for every tool, like a consent box. It is recomputed from each run's saved guard log, so no run predates it.</li>
<li>A tool's total counts its newest run on each form. A single live run varies by about ±1 field: read a 1-2 field difference as noise.</li></ul></details></section>`;

export function page(snapshot, {segment} = {}) {
  const key = pickSegment(snapshot, segment), view = key ? snapshot.segments[key] : null;
  const keys = Object.keys(snapshot?.segments || {});
  const body = !view ? `<section class="card"><h2>No data yet</h2><p class="muted">The bake-off's publish step sends every scored run here (<code>PUT /benchmark/data</code>); the first scored run fills this page.</p></section>`
    : `${key.endsWith(':user') ? '' : `<div class="banner">${esc(segmentLabel(key))}: not what real users run, and never added to user mode. Use it only to compare with itself.</div>`}
${keys.length > 1 ? filterLinks(keys.map(k => [k, segmentLabel(k), `?view=${encodeURIComponent(k)}`]), key) : ''}
${objectiveBlock(view)}${tiles(view)}${scoreboard(view)}${grid(view)}${trend(view)}${METHOD}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Benchmark Form Filling · Admin</title>
<link rel="icon" href="/favicon-32.png"><style>${CSS}</style></head><body><main>
<header><h1>📏 Benchmark Form Filling</h1><span class="muted">${snapshot ? `as of ${esc(snapshot.at.slice(0, 16).replace('T', ' '))} UTC · ${key ? esc(segmentLabel(key)) : ''}` : ''}</span></header>
${body}</main></body></html>`;
}
