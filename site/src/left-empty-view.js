// The look of "Why fields were left empty" (src/left-empty.js): one stacked headline bar with a legend, each row of the two tables coloured by meaning with an inline share bar, reason words as pills.
// Tones use the page's tokens only (--green filled, --violet left on purpose / held, --amber waiting for the person, --red gaps and controls, --muted other). Guard: site/test/left-empty-view.test.js.
import {esc} from './stats.js';

// group / bucket key -> tone. The tone decides the row's edge, bar and pill dot; `soft` is the red of a gap that is ours to close, `bad` the red of a control that failed or a question not read.
export const GROUP_TONE = {answer: 'gap', read: 'bad', control: 'bad', other: 'none'};
export const BUCKET_TONE = {suggested: 'wait', purpose: 'held', gap: 'gap'};
const SEGMENTS = [['good', 'filled', null], ['gap', 'no answer', 'answer'], ['bad', 'controls', 'control'], ['bad2', 'not read', 'read'], ['none', 'other', 'other']];

export const LEFT_EMPTY_CSS = '.le{--le-good:var(--green);--le-held:var(--violet);--le-wait:var(--amber);--le-gap:var(--red);--le-bad:var(--red);--le-none:var(--muted)}'
  + '.le .stack{display:flex;height:14px;border-radius:7px;overflow:hidden;background:var(--line);margin:8px 0 6px}.le .stack i{display:block;height:100%}.le .stack i+i{border-left:1px solid var(--card)}'
  + '.le .legend{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--muted);margin:0 0 6px}.le .legend span:before,.le .dot:before{content:"";display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px;background:var(--tone)}'
  + '.le .t-good{--tone:var(--le-good)}.le .t-held{--tone:var(--le-held)}.le .t-wait{--tone:var(--le-wait)}.le .t-gap{--tone:var(--le-gap)}.le .t-bad,.le .t-bad2{--tone:var(--le-bad)}.le .t-none{--tone:var(--le-none)}'
  + '.le .stack i{background:var(--tone)}.le .stack i.t-gap{opacity:.6}.le .legend .t-gap:before{opacity:.6}.le .stack i.t-bad2{opacity:.8}'
  + '.le tr.row td:first-child{border-left:4px solid var(--tone);padding-left:10px}.le tr.row.t-gap td:first-child{border-left-color:color-mix(in srgb,var(--tone) 60%,transparent)}'
  + '.le tr.row{background:linear-gradient(90deg,color-mix(in srgb,var(--tone) 9%,transparent),transparent 45%)}'
  + '.le .bar{display:inline-block;vertical-align:middle;width:72px;height:8px;border-radius:4px;background:var(--line);margin-right:8px;overflow:hidden}.le .bar i{display:block;height:100%;background:var(--tone)}.le tr.row.t-gap .bar i{opacity:.6}'
  + '.le .words{display:flex;flex-wrap:wrap;gap:4px}.le .wpill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;background:var(--line);white-space:nowrap}.le .wpill .cnt{color:var(--muted);font-weight:600;margin-left:3px}'
  + '.le .wpill:before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px;background:var(--tone)}.le .wpill.t-gap:before{opacity:.6}'
  + '.le details{margin:4px 0}.le summary{cursor:pointer;color:var(--muted);font-size:12px}.le details small{display:block;margin-top:4px}';

export const share = value => (value == null ? '–' : `${Math.round(value * 100)}%`);
const width = value => (value ? Math.max(2, Math.round(value * 100)) : 0);   // one scale for a table: 100% of the column = 100% of the fields; a non-zero share never vanishes
const bar = value => `<span class="bar" aria-hidden="true"><i style="width:${width(value)}%"></i></span>`;
const pills = (items, tone) => `<div class="words">${items.map(item => `<span class="wpill t-${tone}">${esc(item.title ?? item.word)}<span class="cnt">${item.count}</span></span>`).join('') || '<span class="muted">none</span>'}</div>`;

// The headline sentence (kept for the screen reader and the tooltip) and the stacked bar with its legend: filled, then the four groups, each as a share of ALL the required fields.
export function headlineSentence(model) {
  const of = key => model.groups.find(group => group.key === key)?.ofRequired;
  return `${model.required} required fields · ${share(model.filledShare)} filled · ${share(of('answer'))} left with no answer · ${share(of('control'))} lost to controls · ${share(of('read'))} not read`;
}
export function headlineBar(model) {
  const of = key => model.groups.find(group => group.key === key)?.ofRequired || 0;
  const parts = SEGMENTS.map(([tone, label, key]) => ({tone, label, value: key ? of(key) : model.filledShare || 0})).filter(part => part.value > 0);
  return `<p><b>${model.required} required fields</b></p><div class="stack" role="img" aria-label="${esc(headlineSentence(model))}">${parts.map(part => `<i class="t-${part.tone}" style="width:${part.value * 100}%" title="${esc(part.label)} ${share(part.value)}"></i>`).join('')}</div>
<div class="legend">${parts.map(part => `<span class="t-${part.tone}">${esc(part.label)} <b>${share(part.value)}</b></span>`).join('')}</div>`;
}

// Table 1: the four groups. thin: real use under 3 installs (counts only, muted, no bars).
export function groupsTable(model, thin) {
  const rows = model.total ? model.groups.map(group => { const tone = GROUP_TONE[group.key] || 'none';
    return `<tr class="row t-${tone}${thin ? ' muted' : ''}"><td>${esc(group.title)}<br><small class="muted">${esc(group.note)}</small></td><td class="n">${group.count}</td><td class="n">${thin ? '–' : bar(group.share) + share(group.share)}</td><td class="n">${thin ? '–' : bar(group.ofRequired) + share(group.ofRequired)}</td>
<td>${pills(group.words, tone)}</td></tr>`; }).join('\n') : '<tr><td colspan="5" class="muted">No left fields reported in this period.</td></tr>';
  return `<div class="wrap"><table><tr><th>Group</th><th class="n">Fields</th><th class="n">Of left</th><th class="n">Of required</th><th>Reason words</th></tr>\n${rows}</table></div>`;
}

// Table 2: what the unanswered fields were about (answer-gaps.js splitGaps), by bucket.
export function bucketsTable(split, thin) {
  if (!split?.total) return '<p class="muted">No meaning words yet: older apps do not send them.</p>';
  return `<h3>What the unanswered fields were about</h3><small class="muted">Fixed meaning words from the fill card; a field can be counted here and not above (consent, own-words and demographic fields are counted here only).</small>
<div class="wrap"><table><tr><th>Bucket</th><th class="n">Fields</th><th class="n">Share</th><th>Top meanings</th></tr>
${split.buckets.map(bucket => { const tone = BUCKET_TONE[bucket.key] || 'none';
  return `<tr class="row t-${tone}${thin ? ' muted' : ''}"><td>${esc(bucket.title)}<br><small class="muted">${esc(bucket.note)}</small></td><td class="n">${bucket.count}</td><td class="n">${thin ? '–' : bar(bucket.share) + share(bucket.share)}</td>
<td>${pills(bucket.meanings.slice(0, 6), tone)}</td></tr>`; }).join('\n')}</table></div>`;
}
