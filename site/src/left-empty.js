// "Why fields were left empty": the last 14 days of required fields the fill left, in four groups, built once for /admin/real-form-filling (real use) and /admin/lab-form-filling (the pool).
// Both columns come from the fill cards of the last 14 days (their cause words, required and filled counts: one source, so the shares add up): real use = user cards (fewer than 3 installs: counts muted,
// "too few to judge", src/thin-data.js), the lab = pool cards. They are never added together. ONE fixed table maps every reason word to its group: a word missing from it fails site/test/left-empty.test.js, so a new word cannot land in "Other"
// by silence. Later words slot into their group in GROUP_OF: the answer side's meaning words (the answer-side PR 1) under 'answer', the control cause words under 'control'.
import {LEFT_REASONS} from './knowledge.js';   // the words the site accepts from the apps (it mirrors desktop/lib/question-labels.js)
import {CAUSES} from '../../extension/fill-card.js';
import {esc} from './stats.js';
import {splitGaps} from './answer-gaps.js';
import {LEFT_EMPTY_CSS, bucketsTable, groupsTable, headlineBar} from './left-empty-view.js';
import {MIN_INSTALLS, isThin, sampleOf} from './thin-data.js';

export const DAYS = 14;
export const GROUPS = [
  {key: 'answer', title: 'No answer', note: 'the profile, the kit or the AI had none to give'},
  {key: 'read', title: 'Not read, or the page flagged it', note: 'a question the fill never read, or one the person had to fix'},
  {key: 'control', title: 'The control could not be set', note: 'the answer was known, the control did not take it'},
  {key: 'other', title: 'Other', note: 'no reason word fits'},
];
// word -> group. Both vocabularies: the apps' left reasons (src/knowledge.js LEFT_REASONS) and a fill card's cause words (extension/fill-card.js CAUSES).
export const GROUP_OF = {
  no_answer: 'answer', no_data: 'answer', ai_declined: 'answer', ai_unsure: 'answer', ai_off: 'answer', ai_error: 'answer', proposed: 'answer',
  unread: 'read', by_you_unread: 'read', by_you: 'read', page_error: 'read', menu_not_read: 'read',
  not_taken: 'control', menu_not_clicked: 'control', menu_not_opened: 'control', menu_not_selected: 'control', menu_other_choice: 'control', not_kept_after_tries: 'control', real_click: 'control', no_option: 'control',
  other: 'other',
};
// The reason words a learned fix (a recipe: which element is the option, which attribute says "on", the date order and separator) can express; the rest of the control group needs code (a menu that
// empties on typing, loads page by page, redraws after an upload). Today only no_option names the option element; the control cause words (menu_not_selected, ...) join here once they are measured. Used by src/best-case.js.
export const RECIPE_EXPRESSIBLE = ['no_option'];
export const KNOWN_WORDS = [...new Set([...LEFT_REASONS, ...CAUSES])];

const since = (now, days) => new Date(now.getTime() - (days - 1) * 86400000).toISOString().slice(0, 10);

// {word: count} -> {total, groups: [{key, title, note, count, share, words: [{word, count}]}]}; an unknown word is counted under Other and shown there by name.
export function tally(counts) {
  const entries = Object.entries(counts).map(([word, n]) => [word, Number(n) || 0]).filter(([, n]) => n > 0);
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  return {total, groups: GROUPS.map(group => {
    const words = entries.filter(([word]) => (GROUP_OF[word] || 'other') === group.key).map(([word, count]) => ({word, count})).sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
    const count = words.reduce((sum, item) => sum + item.count, 0);
    return {...group, count, share: total ? count / total : null, words};
  })};
}

// The same, against ALL the required fields of those forms: each group's share of required fields and the filled share (required = filled + left, so the headline adds up).
export function withRequired(model, required, filled) {
  const of = value => (required ? value / required : null);
  return {...model, required, filled, filledShare: of(filled), groups: model.groups.map(group => ({...group, ofRequired: of(group.count)}))};
}

// The card's meaning counts (fill_cards.gaps, 0071) summed over the period for one source, split into buckets (src/answer-gaps.js).
const gapsOf = async (db, from, source) => splitGaps(Object.fromEntries(((await db.prepare("SELECT j.key AS word, SUM(j.value) AS n FROM fill_cards c, json_each(c.gaps) j WHERE c.day >= ? AND c.source = ? GROUP BY j.key").bind(from, source).all().catch(() => ({results: []}))).results || []).map(row => [row.word, row.n])));

// side 'real': real installs; 'lab': the owner's pool. Both from the fill cards of the last 14 days (their cause words, required and filled counts: one source, so the shares add up).
// -> {side, days, required, filled, filledShare, total, groups, sample} (sample: only real use, for the thin-data rule).
export async function leftEmpty(db, now = new Date(), side = 'real') {
  const from = since(now, DAYS), source = side === 'lab' ? 'pool' : 'user';
  const none = {results: []};
  const rows = (await db.prepare('SELECT j.key AS word, SUM(j.value) AS n FROM fill_cards c, json_each(c.causes) j WHERE c.day >= ? AND c.source = ? GROUP BY j.key').bind(from, source).all().catch(() => none)).results || [];
  const cards = (await db.prepare('SELECT required, filled, install FROM fill_cards WHERE day >= ? AND source = ?').bind(from, source).all().catch(() => none)).results || [];
  const model = withRequired(tally(Object.fromEntries(rows.map(row => [row.word, row.n]))), cards.reduce((sum, card) => sum + card.required, 0), cards.reduce((sum, card) => sum + card.filled, 0));
  return {side, days: DAYS, ...model, sample: side === 'lab' ? null : sampleOf(cards), gaps: await gapsOf(db, from, source)};
}

const isThinModel = model => model.side === 'real' && isThin(model.sample);
export {LEFT_EMPTY_CSS};

// The headline over all the required fields: one stacked bar (filled, no answer, controls, not read, other) with a legend; counts only while real use is thin.
export function leftEmptyHeadline(model) {
  if (!model.required) return '';
  return isThinModel(model) ? `<p class="muted">${model.required} required fields on those forms · ${model.total} left (too few real fills to judge)</p>` : headlineBar(model);
}

// The headline alone, in a card (the very top of Real Form Filling); nothing when no required field was reported.
export const leftEmptyHeadlineCard = model => { const line = leftEmptyHeadline(model); return line ? `<section class="card le">${line}</section>` : ''; };

// The section's inner HTML (heading, headline, tables). wrap 'card': the form-filling pages' card; 'bare': for a page that already boxes its sections (Lab Form Filling). headline false: the page shows it elsewhere.
export function leftEmptySection(model, {wrap = 'card', headline = true} = {}) {
  const thin = isThinModel(model);
  const where = model.side === 'lab' ? 'the pool\'s fills (the owner\'s fake applicant)' : 'real installs that send technical reports';
  const inner = `<h2>🕳️ Why fields were left empty</h2><small class="muted">Last ${model.days} days: ${where}, per required field.</small>
<details><summary>How this is counted</summary><small class="muted">Source: the fill cards (cause words, required and filled counts), so the shares add up; the older per-field reasons table (fill_reasons) counts more than the cards and is not used here. Four groups from one fixed table of reason words; real use and the lab are never added together.</small></details>
${thin ? `<p><b>Too few real fills to judge: ${model.sample.forms} form${model.sample.forms === 1 ? '' : 's'} from ${model.sample.installs} install${model.sample.installs === 1 ? '' : 's'} in ${model.days} days (needs ${MIN_INSTALLS}+ installs).</b> <span class="muted">Counts only, no shares.</span></p>` : ''}
${headline ? leftEmptyHeadline(model) : ''}
${groupsTable(model, thin)}
${bucketsTable(model.gaps, thin)}`;
  return wrap === 'card' ? `<section class="card le">${inner}</section>` : `<div class="le">${inner}</div>`;
}
