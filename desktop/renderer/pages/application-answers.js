// Settings → Profile → Application answers (owner, 16 Oct 2026: Standard answers and Form knowledge merged; 17 Oct 2026: "too crowded… Make it
// look like this", his mockup): one tab, one save bar, two texts. A search and All · Needs review (n) · Saved; on All, one banner "n questions need
// review" instead of the list; Saved answers = one card, a small header per section, one line per answer (question · value), opened in place
// ("Editing", the answer control of its kind, "Answer as" under Advanced options); the page's own intro (lines before its first heading) is shown
// small, never as answers; Website-specific questions folded (pages/website-rules.js). Never the not-answered mark on screen (renderer/answers-model.js).
// Same on every store: block edits through pages/outline-tab.js. Guarded by test/profile-tabs-render.test.js and test/answers-layout.test.js.
import {el, pill, toggleOnBar} from '../components.js';
import {icon} from '../icons.js';
import {changeFor, kindChange, lineFor, matches, sections, shown} from '../answers-model.js';
import {outlineTab} from './outline-tab.js';
import {isStyle} from './letter-style.js';
import {detailsIn, keyOf, visibleQuestions} from '../question-filter.js';
import {loadQuestions, questionsNow} from './jobs-questions.js';
import {fromDetailsLine} from '../answered-from-details.js';
import {stageAnswer} from '../question-wordings.js';
import {formatFor, markFor, markOf} from '../question-kind.js';
import {answerControl, kindPicker} from '../question-control.js';
import {drawRules, input, labelled, newRule, resetRules, reviewRows, select} from './website-rules.js';

const TEXT = 'answers';
const filters = {query: '', view: 'all'};   // view: all | review | saved
const opened = new Set();   // rows shown open (answer ids, review keys)
const drafts = new Map();   // answer id → the value typed; new questions under `new-<n>`: {section, question, value}
let added = 0, tab = null, rulesOpen = false, verdicts = {}, keptFormats = {}, askedFor = '', showHidden = false, queueAsked = false, lastView = null;
document.addEventListener?.('questions-read', () => lastView?.redraw());
const kinds = new Map();   // answer id → the kind the person picked ("Answer as"), written with the question

const valueOf = item => drafts.get(item.id) ?? item.value;
const missing = item => item.open && !item.optional && !valueOf(item);

// The kind a row is answered with: the person's pick, else its mark in the store, else what this Mac kept (a fill's reading, else the AI's one judgment).
const formatOf = item => kinds.get(item.id) || formatFor({marked: item.mark, kept: keptFormats[keyOf(item.question)]});
const sameMark = (a, b) => markOf(a || {}) === markOf(b || {});
function setAnswer(view, item, text) {
  const mark = item.kind === 'note' ? item.mark : markFor(formatOf(item)), markChanged = !sameMark(mark, item.mark);
  if (text === item.value && !markChanged) { drafts.delete(item.id); view.undo(TEXT, changeFor(item, text)); } else { drafts.set(item.id, text); view.change(TEXT, changeFor(item, text, mark)); }
  if (item.kind === 'cell') { if (markChanged) view.change(TEXT, kindChange(item, mark)); else view.undo(TEXT, kindChange(item, mark)); }
}
// One row's answer control and its "Answer as" choice.
// row: a Needs review row; its other wordings (row.also) get the same answer (renderer/question-wordings.js).
function answerField(view, item, placeholder, row = null) {
  return answerControl(formatOf(item), valueOf(item), text => (row ? stageAnswer(row, text, each => setAnswer(view, each, text)) : setAnswer(view, item, text)), {placeholder, ariaLabel: item.question || 'Note'});
}
function kindField(view, item) {
  return kindPicker(formatOf(item).kind, kind => {
    const before = formatOf(item);
    kinds.set(item.id, formatFor({marked: {kind, options: kind === before.kind ? before.options : [], list: kind === before.kind ? before.list : ''}, kept: keptFormats[keyOf(item.question)]}));
    setAnswer(view, item, valueOf(item));
    view.redraw();
  });
}

// One row: chevron · question (and its hint) · its answer or "Not set"; a row that needs an answer keeps "Add answer". Open: "Editing", the answer
// field, and "Answer as" folded under Advanced options (the kind is read from forms or the AI; the picker only corrects it).
function row(view, {key, title, under, value, needs, field, kind = null, optional = false, button = needs}) {
  const isOpen = opened.has(key);
  const head = el('div', `qa-row${isOpen ? ' is-open' : ''}${button ? '' : ' no-action'}`);
  const toggle = () => { if (isOpen) opened.delete(key); else opened.add(key); view.redraw(); };
  const chevron = Object.assign(el('button', 'link qa-chevron', icon('chevron')), {type: 'button', ariaLabel: isOpen ? 'Close' : 'Open'});
  chevron.classList.add('is-bar-chevron');
  chevron.addEventListener('click', toggle);
  toggleOnBar(head, toggle);
  const words = el('div', 'qa-words');
  words.append(el('b', '', title));
  if (under) words.append(el('span', 'muted small', under));
  head.append(chevron, words, isOpen ? pill('Editing', 'signal') : el('span', value ? 'qa-value' : 'qa-value muted', value ? shown(value) : optional ? 'Optional' : 'Not set'));
  if (button) {
    const action = Object.assign(el('button', 'secondary qa-add', 'Add answer'), {type: 'button'});
    action.addEventListener('click', () => { opened.add(key); view.redraw(); });
    head.append(action);
  }
  if (!isOpen) return [head];
  const edit = el('div', 'qa-edit');
  edit.append(labelled('Your answer', field()));
  const advanced = el('details', 'plain qa-advanced');
  advanced.append(el('summary', 'link', 'Advanced options'));
  if (kind) advanced.append(labelled('Answer as', kind()));
  advanced.append(el('p', 'muted small', 'Left empty, it stays not set and forms ask you again.'));
  edit.append(advanced);
  return [head, edit];
}

// A question saved by a build before 17 Oct 2026 was cut at 120 characters (#1281): said under it, never guessed back.
const cutShort = question => String(question || '').length >= 118 && String(question).length <= 120 && /[\p{L}\p{N}]$/u.test(question);
// A section's notes (an instruction for the AI, not an answer: owner, 17 Oct 2026) folded in one row; still on the page and still sent to the AI.
function noteFold(notes) {
  const fold = el('details', 'plain qa-note-fold');
  fold.append(el('summary', 'muted small', `Note for the AI · ${notes.length === 1 ? '1 paragraph' : `${notes.length} paragraphs`}`),
    ...notes.map(note => el('p', 'muted small qa-note', shown(note.value || note.text))));
  return fold;
}
const answerRow = (view, item) => row(view, {key: item.id, button: false, title: item.kind === 'note' ? 'Note' : shown(item.question),
  under: [item.asked ? `Asked by ${item.asked}` : item.kind === 'note' ? '' : shown(item.hint), item.guess && !drafts.has(item.id) ? 'Unconfirmed: saved as a guess' : '', cutShort(item.question) ? 'Cut short by an older version' : ''].filter(Boolean).join(' · '), value: valueOf(item), needs: missing(item), optional: item.optional,
  field: () => (item.kind === 'note' ? input(valueOf(item), text => setAnswer(view, item, text), {placeholder: 'Your answer', ariaLabel: 'Note'}) : answerField(view, item, item.hint ? `e.g. ${shown(item.hint)}` : 'Your answer')),
  kind: item.kind === 'note' ? null : () => kindField(view, item)});

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

// The search and All · Needs review (n) · Saved.
function toolbar(view, into, reviewCount) {
  const bar = el('div', 'toolbar');
  const search = Object.assign(el('input', ''), {type: 'search', placeholder: 'Search answers…', value: filters.query, ariaLabel: 'Search answers and rules'});
  search.addEventListener('input', () => { filters.query = search.value; const at = search.selectionStart; view.redraw(); const again = into.querySelector('input[type=search]'); again?.focus(); again?.setSelectionRange(at, at); });
  const box = el('label', 'search-box');
  box.append(icon('search'), search);
  const views = el('div', 'segmented');
  views.setAttribute('role', 'group');
  views.setAttribute('aria-label', 'Show');
  for (const [key, name] of [['all', 'All'], ['review', 'Needs review'], ['saved', 'Saved']]) {
    const button = Object.assign(el('button', key === filters.view ? 'is-active' : '', name), {type: 'button'});
    button.dataset.view = key;
    if (key === 'review' && reviewCount) button.append(' ', pill(String(reviewCount), 'warn'));
    button.addEventListener('click', () => { filters.view = key; view.redraw(); });
    views.append(button);
  }
  bar.append(box, views);
  into.append(bar);
}

function draw(view, into) {
  const all = sections(view.items[TEXT] || []).filter(section => !isStyle(section.title));   // the letter style is the Cover letter tab's (letter-style.js)
  // The page's own intro (the lines before its first heading) explains the page: shown small, never as answers (a page with no heading is all answers).
  const intro = all.length > 1 && !all[0].title ? all[0] : null;
  const list = intro ? all.slice(1) : all;

  // Needs review: what forms will still ask (an answer not set, a website rule with no value).
  const candidates = list.flatMap(section => section.items.filter(item => item.open && !item.optional && !drafts.has(item.id) && matches(item, {query: filters.query}))
    .map(item => ({item, section})));
  // The same filter as Jobs → Answer once: readable, reusable, not already answered; the rest is "N hidden · show" (nothing deleted). The AI's verdicts are asked once per set of questions.
  const labels = candidates.map(each => each.item.question), signature = labels.join('\n');
  if (labels.length && signature !== askedFor) {
    askedFor = signature;
    const unmarked = candidates.filter(each => !each.item.mark?.kind).map(each => each.item.question);
    Promise.resolve(window.pilot.questionVerdicts(labels, unmarked)).then(result => { if (result?.ok) { verdicts = {...verdicts, ...result.verdicts}; keptFormats = {...keptFormats, ...(result.formats || {})}; view.redraw(); } }).catch(() => {});
  }
  const {shown: shownRows, hidden: hiddenRows, fromDetails} = visibleQuestions(candidates.map(each => ({...each, question: each.item.question})), verdicts);
  const ruleRows = reviewRows(view, filters.query).filter(each => !each.value);
  const reviewCount = shownRows.length + ruleRows.length;

  toolbar(view, into, reviewCount);
  for (const key of [...drafts.keys()].filter(k => String(k).startsWith('new-'))) into.append(newQuestion(view, key, list));

  // The banner counts what the drawer walks through (the questions, owner 17 Oct 2026: "make the count match the review queue"); website rules stay under Needs review.
  // Your details' unclear fields are in that queue too (owner, 18 Oct 2026: "One queue for all"): the queue's own list, read once if Jobs has not read it yet.
  lastView = view;
  if (!questionsNow().read && !queueAsked) { queueAsked = true; loadQuestions().catch(() => {}); }
  const asked = shownRows.length + detailsIn(questionsNow().list).length;
  if (filters.view === 'all' && asked) {
    const banner = el('div', 'notice qa-banner');
    const go = Object.assign(el('button', 'primary small-btn', 'Review questions'), {type: 'button', id: 'answers-review-go'});
    // The questions are reviewed one at a time in the drawer Jobs opens too (pages/question-review.js): one review flow, two ways in.
    go.addEventListener('click', () => import('./question-review.js').then(review => review.openQuestionReview()));
    banner.append(el('span', '', `⚠ ${asked} question${asked === 1 ? '' : 's'} need${asked === 1 ? 's' : ''} review`), ...(fromDetails.length ? [el('span', 'muted small', fromDetailsLine(fromDetails.length))] : []), go);
    into.append(banner);
  }

  if (filters.view === 'review') {
    const open = showHidden ? [...shownRows, ...hiddenRows] : shownRows;
    const review = card('Needs review', 'alert', [pill(`${reviewCount} not set`, 'warn', {dot: true})]);
    review.classList.add('is-review');
    for (const entry of open) {
      const {item, section} = entry;
      review.append(...row(view, {key: `review:${item.id}`, title: shown(item.question), under: shown(section.title) || 'Answers', value: valueOf(item), needs: true,
      field: () => answerField(view, item, item.hint ? `e.g. ${shown(item.hint)}` : 'Your answer', entry), kind: () => kindField(view, item)}));
    }
    for (const each of ruleRows) review.append(...row(view, {...each, needs: true}));
    if (hiddenRows.length) {
      const more = Object.assign(el('button', 'link', showHidden ? 'Hide the others' : `${hiddenRows.length} hidden · show`), {type: 'button', id: 'review-hidden'});
      more.addEventListener('click', () => { showHidden = !showHidden; view.redraw(); });
      review.append(more);
    }
    if (!open.length && !ruleRows.length && !hiddenRows.length) review.append(el('p', 'muted qa-empty', 'Nothing to review: forms have every answer they asked for.'));
    into.append(review);
    return;
  }

  // Saved answers: one card, a small header per section, one line per answer.
  const saved = card('Saved answers', 'file-text');
  saved.classList.add('qa-saved');
  // Base facts live in Your details only (owner, 17 Oct 2026): a row there with no answer here is not repeated as "Not set".
  const inDetails = new Set(fromDetails.map(each => each.item.id));
  if (fromDetails.length && filters.view !== 'review') saved.append(el('p', 'muted small qa-from-details', `${fromDetailsLine(fromDetails.length)}: edit them in Your details`));
  if (intro) for (const item of intro.items) saved.append(el('p', 'muted small qa-intro', shown(item.question ? `${item.question}: ${item.value}` : item.value || item.text)));
  let any = false;
  for (const section of list) {
    const items = section.items.filter(item => item.kind !== 'note' && !(missing(item) && inDetails.has(item.id)) && (filters.view !== 'saved' || !missing(item))
      && matches({...item, value: valueOf(item), open: missing(item)}, {query: filters.query}));
    const notes = filters.query || filters.view === 'review' ? [] : section.items.filter(item => item.kind === 'note');
    if (!items.length && !notes.length) continue;
    any = true;
    saved.append(el('h5', 'qa-group', shown(section.title) || 'Answers'));
    if (notes.length) saved.append(noteFold(notes));
    for (const item of items) saved.append(...answerRow(view, item));
  }
  if (!any) saved.append(el('p', 'muted qa-empty', list.length ? 'No answer matches this search.' : 'No standard answers yet: they are added as forms ask questions, or with Add answer.'));
  into.append(saved);

  // Website-specific questions, folded: exceptions and what Job Pilotto learned from forms.
  const rules = el('details', 'answer-item qa-section kn-rules');
  rules.open = rulesOpen || !!filters.query;
  rules.addEventListener('toggle', () => { rulesOpen = rules.open; });
  const summary = el('summary', 'qa-section-head');
  const words = el('div', 'qa-words');
  const count = el('span', 'muted small');
  words.append(el('h4', '', 'Website-specific questions'), count);
  const add = Object.assign(el('button', 'secondary with-icon', icon('plus')), {type: 'button', id: 'rules-add'});
  add.append('Add rule');
  add.addEventListener('click', event => { event.preventDefault(); newRule(); rulesOpen = true; view.redraw(); });
  summary.append(icon('globe'), words, add, Object.assign(el('span', 'qa-chevron', icon('chevron')), {ariaHidden: 'true'}));
  const inner = el('div', 'kn-body');
  rules.append(summary, inner);
  const learned = drawRules(view, inner, filters.query).count;
  count.textContent = `Review how form questions map to your saved answers · ${learned} learned from forms`;
  into.append(rules);
}

export function addQuestion() {
  const key = `new-${++added}`;
  const list = sections(tab?.items(TEXT) || []);
  drafts.set(key, {section: list[list.length - 1]?.title || '', question: '', value: ''});
  tab?.redraw();
}
// The question review's "Manage saved answers" / "View source": the tab opens searched for that answer.
export function searchAnswers(query = '') { filters.query = String(query || ''); }
export function addRule() { newRule(); rulesOpen = true; tab?.redraw(); }

export async function loadApplicationAnswers() {
  const node = document.getElementById('answers-body');
  if (!node) return;
  if (!tab || tab.node !== node) {
    tab = {...outlineTab('answers', [TEXT, 'knowledge'], node, draw, {onReset: () => { drafts.clear(); kinds.clear(); opened.clear(); resetRules(); }}), node};
  }
  filters.view = 'all';   // the tab opens on All
  await tab.load();
}
