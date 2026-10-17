// Settings → Profile → Application answers (owner, 16 Oct 2026: Standard answers and Form knowledge merged, from the owner's mockups): one tab,
// one save bar, two texts. Needs review (answers not set, website rules with no value) first; Your answers (a section card per heading of the
// standard answers, "Some answers are missing", a row per question that opens to its answer field); Website-specific rules collapsed
// (pages/website-rules.js). Never a ❓ on screen (renderer/answers-model.js). Same on every store: block edits through pages/outline-tab.js.
// Guarded by test/profile-tabs-render.test.js.
import {el, pill, toggleOnBar} from '../components.js';
import {icon} from '../icons.js';
import {changeFor, lineFor, matches, sections, shown} from '../answers-model.js';
import {outlineTab} from './outline-tab.js';
import {drawRules, input, labelled, newRule, resetRules, reviewRows, select} from './website-rules.js';

const TEXT = 'answers';
const filters = {query: '', review: false, section: ''};
const opened = new Set();   // rows shown open (answer ids, review keys)
const drafts = new Map();   // answer id → the value typed; new questions under `new-<n>`: {section, question, value}
let added = 0, tab = null, rulesOpen = false;

const valueOf = item => drafts.get(item.id) ?? item.value;
const missing = item => item.open && !item.optional && !valueOf(item);
// Sections are collapsed by default (owner, 17 Oct 2026); the ones the person opened are remembered on this Mac.
const OPEN_KEY = 'answersOpenSections';
const remembered = () => { try { return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) || '[]')); } catch { return new Set(); } };
const remember = set => { try { localStorage.setItem(OPEN_KEY, JSON.stringify([...set])); } catch {} };
const openSections = remembered();

function setAnswer(view, item, text) {
  if (text === item.value) { drafts.delete(item.id); view.undo(TEXT, changeFor(item, text)); } else { drafts.set(item.id, text); view.change(TEXT, changeFor(item, text)); }
}

// One row: chevron · question (and its hint) · its answer or "Not set" · Add answer / Edit; open, the answer field under it.
function row(view, {key, title, under, value, needs, field, optional = false}) {
  const isOpen = opened.has(key);
  const head = el('div', `qa-row${isOpen ? ' is-open' : ''}`);
  const toggle = () => { if (isOpen) opened.delete(key); else opened.add(key); view.redraw(); };
  const chevron = Object.assign(el('button', 'link qa-chevron', icon('chevron')), {type: 'button', ariaLabel: isOpen ? 'Close' : 'Open'});
  chevron.classList.add('is-bar-chevron');
  chevron.addEventListener('click', toggle);
  toggleOnBar(head, toggle);
  const words = el('div', 'qa-words');
  words.append(el('b', '', title));
  if (under) words.append(el('span', 'muted small', under));
  const action = Object.assign(el('button', needs ? 'secondary qa-add' : 'secondary', needs ? 'Add answer' : 'Edit'), {type: 'button'});
  action.addEventListener('click', () => { opened.add(key); view.redraw(); });
  head.append(chevron, words, el('span', value ? 'qa-value' : 'qa-value muted', value ? shown(value) : optional ? 'Optional' : 'Not set'), action);
  if (!isOpen) return [head];
  const edit = el('div', 'qa-edit');
  edit.append(labelled('Answer', field()), el('p', 'muted small', 'Left empty, it stays not set and forms ask you again.'));
  return [head, edit];
}

const answerRow = (view, item) => row(view, {key: item.id, title: item.kind === 'note' ? 'Note' : shown(item.question),
  under: item.asked ? `Asked by ${item.asked}` : item.kind === 'note' ? '' : shown(item.hint), value: valueOf(item), needs: missing(item), optional: item.optional,
  field: () => input(valueOf(item), text => setAnswer(view, item, text), {placeholder: item.hint ? `e.g. ${shown(item.hint)}` : 'Your answer', ariaLabel: item.question || 'Note'})});

function newQuestion(view, key, list) {
  const draft = drafts.get(key);
  const after = () => (list.find(section => section.title === draft.section) || list[list.length - 1])?.after;
  const sync = () => { view.undo(TEXT, {op: 'insert', key}); if (draft.question.trim() && after()) view.change(TEXT, {op: 'insert', after: after(), key, lines: [lineFor(draft.question, draft.value)]}); };
  const edit = el('div', 'qa-edit is-new form-grid cols-3');
  edit.append(labelled('Question', input(draft.question, value => { draft.question = value; sync(); }, {placeholder: 'As forms ask it'})),
    labelled('Answer', input(draft.value, value => { draft.value = value; sync(); }, {placeholder: 'Left empty: not set'})),
    labelled('Section', select(list.map(section => [section.title, section.title || 'Answers']), draft.section, value => { draft.section = value; sync(); }, 'Section')));
  return edit;
}

function card(title, glyph, extra = []) {
  const box = el('section', 'answer-item qa-section'), head = el('div', 'qa-section-head');
  head.append(icon(glyph), el('h4', '', title), ...extra);
  box.append(head);
  return box;
}

function draw(view, into) {
  const list = sections(view.items[TEXT] || []);
  const bar = el('div', 'toolbar');
  const search = Object.assign(el('input', ''), {type: 'search', placeholder: 'Search answers and rules…', value: filters.query, ariaLabel: 'Search answers and rules'});
  search.addEventListener('input', () => { filters.query = search.value; const at = search.selectionStart; view.redraw(); const again = into.querySelector('input[type=search]'); again?.focus(); again?.setSelectionRange(at, at); });
  const box = el('label', 'search-box');
  box.append(icon('search'), search);
  bar.append(box, select([['', 'All answers'], ['review', 'Needs review']], filters.review ? 'review' : '', value => { filters.review = !!value; view.redraw(); }, 'Show'),
    select([['', 'All categories'], ...list.filter(s => s.title).map(s => [s.title, shown(s.title)])], filters.section, value => { filters.section = value; view.redraw(); }, 'Category'));
  into.append(bar);
  for (const key of [...drafts.keys()].filter(k => String(k).startsWith('new-'))) into.append(newQuestion(view, key, list));

  // Needs review: what forms will still ask (an answer not set, a website rule with no value).
  const inScope = section => !filters.section || section.title === filters.section;
  const open = list.filter(inScope).flatMap(section => section.items.filter(item => item.open && !item.optional && !drafts.has(item.id) && matches(item, {query: filters.query}))
    .map(item => ({item, section})));
  const ruleRows = filters.section ? [] : reviewRows(view, filters.query).filter(each => !each.value);
  if (open.length || ruleRows.length) {
    const review = card('Needs review', 'alert', [pill(`${open.length + ruleRows.length} not set`, 'warn', {dot: true})]);
    review.classList.add('is-review');
    for (const {item, section} of open) review.append(...row(view, {key: `review:${item.id}`, title: shown(item.question), under: shown(section.title) || 'Answers', value: valueOf(item), needs: true,
      field: () => input(valueOf(item), text => setAnswer(view, item, text), {placeholder: item.hint ? `e.g. ${shown(item.hint)}` : 'Your answer', ariaLabel: item.question})}));
    for (const each of ruleRows) review.append(...row(view, {...each, needs: true}));
    into.append(review);
  }

  // Your answers.
  let any = false;
  for (const section of list) {
    if (!inScope(section)) continue;
    const items = section.items.filter(item => matches({...item, value: valueOf(item), open: missing(item)}, {query: filters.query, attention: filters.review}));
    if (!items.length) continue;
    any = true;
    const title = shown(section.title) || 'Your answers', gaps = section.items.filter(missing).length;
    const box = el('details', 'answer-item qa-section qa-fold');
    box.open = openSections.has(title) || !!filters.query || filters.review || !!filters.section;   // a search or filter shows what it found
    box.addEventListener('toggle', () => { if (filters.query || filters.review || filters.section) return; if (box.open) openSections.add(title); else openSections.delete(title); remember(openSections); });
    const head = el('summary', 'qa-section-head');
    head.append(icon('file-text'), el('h4', '', title), el('span', 'muted small', `${section.items.filter(item => !item.open).length} set · ${gaps} missing`));
    box.append(head);
    for (const item of items) box.append(...answerRow(view, item));
    into.append(box);
  }
  if (!any && !filters.review) into.append(el('p', 'muted', list.length ? 'No answer matches these filters.' : 'No standard answers yet: they are added as forms ask questions, or with Add question.'));

  // Website-specific rules, collapsed: exceptions and what Job Pilotto learned from forms.
  const rules = el('details', 'answer-item qa-section kn-rules');
  rules.open = rulesOpen || !!filters.query;
  rules.addEventListener('toggle', () => { rulesOpen = rules.open; });
  const summary = el('summary', 'qa-section-head');
  const count = el('span', 'muted small');
  summary.append(icon('globe'), el('h4', '', 'Website-specific rules'), count);
  const add = Object.assign(el('button', 'secondary with-icon', icon('plus')), {type: 'button', id: 'rules-add'});
  add.append('Add rule');
  add.addEventListener('click', event => { event.preventDefault(); newRule(); rulesOpen = true; view.redraw(); });
  summary.append(add);
  const inner = el('div', 'kn-body');
  rules.append(summary, inner);
  count.textContent = `${drawRules(view, inner, filters.query).count} learned from forms`;
  into.append(rules);
}

export function addQuestion() {
  const key = `new-${++added}`;
  const list = sections(tab?.items(TEXT) || []);
  drafts.set(key, {section: filters.section || list[list.length - 1]?.title || '', question: '', value: ''});
  tab?.redraw();
}
export function addRule() { newRule(); rulesOpen = true; tab?.redraw(); }

export async function loadApplicationAnswers() {
  const node = document.getElementById('answers-body');
  if (!node) return;
  if (!tab || tab.node !== node) {
    tab = {...outlineTab('answers', [TEXT, 'knowledge'], node, draw, {onReset: () => { drafts.clear(); opened.clear(); resetRules(); }}), node};
  }
  await tab.load();
}
