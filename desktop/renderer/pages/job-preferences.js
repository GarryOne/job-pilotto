// Strategy → Job preferences (owner, 17 Oct 2026: "Must-haves / deal-breakers: determine whether it is acceptable. Preferences: improve a job's
// ranking"; was Settings → Profile → Preferences, the owner's mockup of 16 Oct 2026). Two sides, each the fields it owns (chips, selects, workload
// min/max) and its other rules folded under a one-line summary ("No on-call · Exclude recruitment agencies · 2 more"), plus "Add a deal-breaker" /
// "Add a preference". Each control writes back only its own cell or line of the Profile (renderer/preferences-model.js), on every store, through
// pages/outline-tab.js's one save bar. Work mode, seniority and the minimum salary are Goals' (above); permit, languages and the salary expectation
// are Your details'. Guarded by test/job-preferences.test.js and test/profile-tabs-render.test.js.
import {el} from '../components.js';
import {icon} from '../icons.js';
import {changeFor, shown} from '../answers-model.js';
import {FIELDS, MODES, SIDES, chipsOf, chipsText, fieldChange, modesOf, modesText, readProfile, summaryOf, workloadOf, workloadText} from '../preferences-model.js';
import {NOTE_LABEL, noteText, showWorkload} from '../preferences-review-model.js';
import {lineInput, outlineTab} from './outline-tab.js';
import {reviewCard, textsOf} from './preferences-review.js';
import {input, labelled, select} from './website-rules.js';
import {strategyBarNow} from './strategy-cards.js';

const TEXT = 'profile';
const typed = new Map();   // field key or item id → the text as edited
let tab = null;
const folded = {must: false, rank: false};
const review = {key: '', parse: null, error: '', busy: false, asked: false};   // the AI's reading of the fields (preferences-review.js), asked once per tab load
const handled = new Set();   // review fields accepted into the draft
let lastView = null;       // the tab as last drawn, for the Review button

// A field's current text, and the setter that drafts its change (or drops it when back to what the page says).
function binding(view, field, item, anchor) {
  const original = item?.value || '';
  return {
    text: () => typed.get(field.key) ?? original,
    set(text) {
      const change = fieldChange(field, item, text, anchor);
      if (text === original) { typed.delete(field.key); view.undo(TEXT, change); } else { typed.set(field.key, text); view.change(TEXT, change); }
    },
  };
}

function chips(view, field, bind) {
  const box = el('div', 'pref-chips');
  const list = el('div', 'chip-list');
  for (const [i, chip] of chipsOf(bind.text()).entries()) {
    const node = el('span', 'chip removable', chip);
    const x = Object.assign(el('button', 'x', '×'), {type: 'button', ariaLabel: `Remove ${chip}`});
    x.addEventListener('click', () => { const next = chipsOf(bind.text()); next.splice(i, 1); bind.set(chipsText(next)); view.redraw(); });
    node.append(x);
    list.append(node);
  }
  const add = Object.assign(el('input', ''), {type: 'text', placeholder: field.add, ariaLabel: field.add});
  const commit = () => { if (add.value.trim()) { bind.set(chipsText([...chipsOf(bind.text()), add.value.trim()])); view.redraw(); } };
  add.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ',') { event.preventDefault?.(); commit(); } });
  add.addEventListener('change', commit);
  box.append(list, add);
  return box;
}

function modes(view, bind) {
  const box = el('div', 'segmented is-fill pref-modes');
  const chosen = modesOf(bind.text());
  for (const mode of MODES) {
    const on = chosen.includes(mode);
    const button = Object.assign(el('button', on ? 'is-active' : '', mode), {type: 'button'});
    button.setAttribute('aria-pressed', String(on));
    button.addEventListener('click', () => { bind.set(modesText(on ? chosen.filter(m => m !== mode) : [...chosen, mode])); view.redraw(); });
    box.append(button);
  }
  return box;
}

function workload(bind) {
  const box = el('div', 'form-grid cols-2');
  const now = workloadOf(bind.text());
  const part = (key, text, placeholder) => {
    const field = Object.assign(el('input', ''), {type: 'number', min: 0, max: 100, value: now[key], placeholder, ariaLabel: text});
    field.addEventListener('input', () => { now[key] = field.value; bind.set(workloadText(now)); });
    return labelled(text, field);
  };
  box.append(part('min', 'Workload (minimum %)', 'e.g. 50'), part('max', 'Workload (maximum %)', 'e.g. 100'));
  return box;
}

function control(view, field, item, anchor) {
  const bind = binding(view, field, item, anchor);
  const hint = item?.hint ? `e.g. ${shown(item.hint)}` : field.placeholder || 'Not set';
  if (field.widget === 'chips') return labelled(field.label, chips(view, field, bind));
  if (field.widget === 'modes') return labelled(field.label, modes(view, bind));
  if (field.widget === 'workload') { const box = workload(bind); box.classList.add('span-all'); return box; }
  if (field.widget === 'select') {
    const now = bind.text();
    const options = [['', 'Not set'], ...[...new Set([...field.options, ...(now ? [now] : [])])].map(option => [option, option])];
    return labelled(field.label, select(options, now, value => bind.set(value), field.label));
  }
  return labelled(field.label, input(bind.text(), value => bind.set(value), {placeholder: hint, ariaLabel: field.label}));
}

// A rule of a side: its label and one input (a sentence without a label is its own text).
const itemField = (view, item) => lineInput(view, TEXT, item, typed);

// The Original wording note: collapsed, the sentences kept from what you typed before the review.
function noteBox(view, note) {
  const box = el('details', 'span-all pref-note');
  box.append(el('summary', '', 'Original wording'));
  box.append(itemField(view, {...note, label: ''}));
  return box;
}

// What "Add a deal-breaker" / "Add a preference" writes: a sentence under Deal-breakers, else a labelled line after the side's section (a sentence
// there would read as the template's explanation); nothing when the Profile has no section for that side.
function addChange(side, ends, text) {
  if (side === 'must' && ends.rules) return {op: 'insert', after: ends.rules, key: 'add-must', lines: [text]};
  const after = ends[side];
  return after && {op: 'insert', after, key: `add-${side}`, lines: [`${side === 'must' ? 'Deal-breaker' : 'Preference'}: ${text}`]};
}

function side(view, key, {fields, other, ends, note}, anchor) {
  const group = SIDES[key];
  const box = el('section', 'answer-item qa-section pref-section');
  box.dataset.side = key;
  const head = el('div', 'qa-section-head pref-head');
  const words = el('div', 'pref-words');
  words.append(el('h4', '', group.title), el('span', 'muted small', group.lead));
  head.append(icon(group.icon), words);
  const grid = el('div', 'form-grid cols-2 pref-body');
  // Workload is kept in the Profile but shown only for people whose countries include CH, DE or AT (owner, 17 Oct 2026).
  const countries = typed.get('countries') ?? fields.countries?.value ?? '';
  for (const field of FIELDS.filter(each => each.side === key && (each.key !== 'workload' || showWorkload(countries, review.parse?.countries)))) grid.append(control(view, field, fields[field.key], anchor));
  const rules = other.filter(item => item.side === key);
  const more = el('details', 'span-all pref-more');
  more.open = folded[key];
  more.addEventListener('toggle', () => { folded[key] = more.open; });
  const line = el('summary', 'pref-more-head');
  line.append(el('b', '', key === 'must' ? 'Other deal-breakers' : 'Other preferences'), el('span', 'muted small pref-summary', summaryOf(rules)));
  const list = el('div', 'form-grid cols-2 pref-body');
  for (const item of rules) list.append(itemField(view, item));
  if (key === 'rank' && note) list.append(noteBox(view, note));   // the review's one Original wording note
  const adding = typed.get(`add-${key}`) || '';
  const add = input(adding, text => {
    const change = addChange(key, ends, text.trim());
    if (!change) return;
    if (!text.trim()) { typed.delete(`add-${key}`); view.undo(TEXT, change); } else { typed.set(`add-${key}`, text); view.change(TEXT, change); }
  }, {placeholder: group.add, ariaLabel: group.add});
  if (addChange(key, ends, 'x')) list.append(labelled(group.add, add, true));
  more.append(line, list);
  grid.append(more);
  box.append(head, grid);
  return box;
}

// The one "Original wording" note: the phrases the clean values lose, for the accepted fields; added to a note already there, or a new line.
let noteDraft = null;
function draftNote(view, fields, note, anchor) {
  if (noteDraft) view.undo(TEXT, noteDraft);
  const labels = Object.fromEntries(FIELDS.map(field => [field.key, field.label]));
  const text = noteText(review.parse, labels, [...handled]);
  noteDraft = !text ? null : note ? changeFor(note, [note.value, text].filter(Boolean).join('; '))
    : fieldChange({key: 'original-wording', label: NOTE_LABEL}, null, text, anchor);
  if (noteDraft) view.change(TEXT, noteDraft);
}

// One read of the fields' text (cached per text by the main process); the card appears when the AI flags a field as unparsed.
async function readFields(view, again = false) {
  const all = readProfile(view.items[TEXT] || []).fields;
  const fields = {...drawn(all), countries: all.countries};   // Countries are no longer drawn here (Strategy → Locations), but the Workload rule reads them
  review.busy = true; review.asked = true; view.redraw();
  const answer = (await Promise.resolve(window.pilot.preferencesParse({fields: textsOf(fields), again})).catch(error => ({error: error.message}))) || {};
  Object.assign(review, {busy: false, parse: answer.parse || null, key: answer.key || '', error: answer.error && answer.error !== 'no AI' ? answer.error : ''});
  view.redraw();
}

function draw(view, into) {
  const read = readProfile(view.items[TEXT] || []);
  if (!review.asked && window.pilot.preferencesParse) setTimeout(() => readFields(view), 0);
  lastView = view;
  const reviewNode = reviewCard({fields: drawn(read.fields), state: review, handled, redraw: view.redraw,
    apply: (field, item, text) => binding(view, field, item, read.anchor).set(text),
    note: () => draftNote(view, read.fields, read.note, read.anchor)});
  if (reviewNode) into.append(reviewNode);
  for (const key of Object.keys(SIDES)) into.append(side(view, key, read, read.anchor));
}

// Only the fields this card draws are reviewed (the others are edited in Goals or Your details).
const drawn = fields => Object.fromEntries(Object.entries(fields).filter(([key]) => FIELDS.find(field => field.key === key)?.side));

export async function loadPreferences() {
  const node = document.getElementById('preferences-body');
  if (!node) return;
  if (!tab || tab.node !== node) tab = {...outlineTab('preferences', [TEXT], node, draw, {onReset: () => { typed.clear(); handled.clear(); noteDraft = null; }, words: 'Future searches and scores use them once you save.',
    bar: strategyBarNow(), tab: 'strategy-yours', label: 'Job preferences'}), node};
  review.asked = false;
  await tab.load();
}

// The "Review your preferences" button (also in ⌘K): read the fields again (asks the AI only when their text changed, or the last read failed).
export const reviewPreferences = () => lastView && readFields(lastView, !!review.error);
