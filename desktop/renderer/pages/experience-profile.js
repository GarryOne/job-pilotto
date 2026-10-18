// Settings → Profile: the Profile page's own sections as folded cards with Edit (owner, 17 Oct 2026: "It should be properly formatted. It should be
// collapsed, it should be using cards"). Experience: summary and strengths open, education and any section the app does not know folded; Strengths
// as one row per "Label:" with its values as tags; a heading's "(…)" note and lines in brackets shown small. The role history is drawn by the job
// cards, never here. Your details: the voluntary survey answers. Read from the Profile's outline and saved block by block on every store (IPC
// textOutline / textEdit); the model is renderer/experience-profile-model.js. Cards are the Application answers' folds (.answer-item.qa-fold).
// Guarded by test/experience-profile.test.js and test/experience-cards.test.js.
import {cardEdit, el, loadingCard, pill} from '../components.js';
import {chipLine, doneButton, setEditing} from '../card-shell.js';
import {keep, swr} from '../swr.js';
import {icon} from '../icons.js';
import {$, message} from './core.js';
import {surveyBody, surveyForm} from '../survey-rows.js';
import {foldsChanged, forgetCards, registerCard} from '../profile-fold.js';
import {gapsBody, pendingCount} from '../gaps-rows.js';
import {setState} from '../gaps-model.js';
import {changesFor, groupsOf, isEmpty, isNote, partsOn, previewOf, profileParts, shownText} from '../experience-profile-model.js';
import {fieldsOf} from '../education-model.js';
import {educationEditor, linesEditor, strengthsEditor, summaryEditor} from '../experience-editors.js';
import {profileBar} from './profile-save-bar.js';
import {rebaseChanges} from '../outline-rebase.js';

// Where each tab draws its parts: the box and its message line in index.html.
const BOXES = {experience: ['exp-profile', 'exp-profile-message'], details: ['details-profile', 'details-profile-message']};
const OPEN_FIRST = new Set(['summary', 'strengths']);   // shown open until the person folds them (owner, 17 Oct 2026)
const parts = {}, outlines = {};   // per tab: its parts, and the outline they were read from (an editor's changes are moved onto a fresh read before writing)
const setParts = (tab, items) => { parts[tab] = profileParts(items); outlines[tab] = items; };
const folded = new Map();   // part key → open (true) or folded (false), as the person left it
const editing = new Set();
const editors = new Map();   // part key → its open editor {node, changes(), tab, items, sync}
const sources = new Map();   // part key → its source on the Profile's save bar (registered once)
let gapsTidied = null, gapsAsked = false;   // the one-time CV gaps split: what it did (for Undo), and whether this window asked yet

export async function loadExperienceProfile(tab = 'experience') {
  const [boxId, messageId] = BOXES[tab];
  if (!$(boxId)) return;
  const box = $(boxId);
  await swr('profile-parts', () => window.pilot.textOutline('profile'), {
    loading: () => box.replaceChildren(loadingCard('Reading your Profile…')),
    paint: (result, kept) => { if (kept || !editing.size) { setParts(tab, result.items); draw(tab); if (tab === 'experience') splitGaps(tab); } },   // a refresh never redraws a card under edit
    fail: result => message(messageId, `Couldn't read your Profile: ${result?.error || 'try again'}`, 'error'),
  });
}

// Once per window: the CV gaps paragraph becomes one line per gap (lib/gaps-move.js); the card then shows what it did, with Undo.
async function splitGaps(tab) {
  if (gapsAsked || !parts[tab]?.gaps) return;
  gapsAsked = true;
  const result = await window.pilot.moveCvGaps?.().catch(() => null);
  gapsTidied = result?.tidied || null;
  if (result?.ok && (result.changed || gapsTidied)) await reread(tab);
}
// Your details' moves are settling (pages/details-facts.js): the survey card says so, and reads its lines again when they are done (the move rewrites them in the store).
let sorting = false;
document.addEventListener?.('details-sorting', async event => {
  sorting = Boolean(event.detail?.on);
  if (parts.details && !editing.size) draw('details');
  if (!sorting && event.detail?.changed && !editing.size && parts.details) await reread('details');
});
async function reread(tab) {
  const fresh = await window.pilot.textOutline('profile').catch(() => null);
  if (fresh?.items) { setParts(tab, fresh.items); keep('profile-parts', {...fresh, ok: true}); draw(tab); }
}
// A chip pressed: ✓ a confirmed skill, ✕ not a gap, Undo back to "to check": that one line is rewritten in the store.
async function pressGap(tab, part, item, state) {
  const was = part.lines.find(line => line.id === item.id)?.text;
  if (was === undefined) return;
  const result = await window.pilot.textEdit('profile', [{op: 'text', id: item.id, value: setState(was, state), was}]).catch(error => ({ok: false, error: error.message}));
  if (result.items) { setParts(tab, result.items); keep('profile-parts', {...result, ok: true}); draw(tab); }
  if (!result.ok) message(BOXES[tab][1], result.error, 'error');
}
async function undoGaps(tab) {
  const result = await window.pilot.undoCvGaps().catch(error => ({ok: false, error: error.message}));
  if (result.ok) { gapsTidied = null; await reread(tab); } else message(BOXES[tab][1], result.error, 'error');
}

function draw(tab) {
  forgetCards(tab);
  const list = partsOn(parts[tab], tab);
  // A panel with one part (Your details' Voluntary surveys) already says its name: no card around it.
  $(BOXES[tab][0]).replaceChildren(...list.map(each => (list.length === 1 ? solo(tab, each) : card(tab, each))));
  foldsChanged();
}

// The card's Edit/Add: the shared header button (components.js cardEdit), at the right of the title line.
const editButton = (tab, each) => {
  const empty = isEmpty(each.part);
  return cardEdit(empty ? 'Add' : 'Edit', each.title.toLowerCase(), event => { event.preventDefault(); startEdit(tab, each); });
};

function card(tab, each) {
  const {key, title, part} = each;
  const box = el('details', 'answer-item qa-section qa-fold exp-part');
  box.dataset.part = key;
  box.open = folded.has(key) ? folded.get(key) : OPEN_FIRST.has(key) || editing.has(key);
  box.addEventListener('toggle', () => { folded.set(key, box.open); foldsChanged(); });
  registerCard(box, tab);   // the tab's fold bar opens and folds it with the rest (profile-fold.js)
  const head = el('summary', 'qa-section-head');
  const count = key === 'strengths' ? part?.lines.length : 0, toReview = key === 'gaps' ? pendingCount(part) : 0;
  // The CV gaps are decided row by row (Confirm skill / Dismiss), never edited as lines: no Edit on that card (owner review fix 6, 18 Oct 2026).
  head.append(icon('file-text'), el('h4', '', title), ...(part?.note ? [el('span', 'muted small', part.note)] : []), ...(count ? [el('span', 'muted small', String(count))] : []),
    ...(toReview ? [pill(`${toReview} to review`, 'warn')] : []), el('span', 'exp-part-gap'), ...(key === 'gaps' ? [] : [editButton(tab, each)]));
  setEditing(box, editing.has(key));
  box.append(head, editing.has(key) ? editorOf(key, box) : key === 'gaps' ? gapsBody(part, (item, state) => pressGap(tab, part, item, state), {tidied: gapsTidied, onUndo: () => undoGaps(tab)}) : body(key, part));
  return box;
}

// A panel with one part: its title is the panel's own (index.html), so the button goes in that title line (the slot next to it).
function solo(tab, each) {
  const box = el('div', 'exp-part'), slot = $(`${BOXES[tab][0]}-edit`);
  box.dataset.part = each.key;
  slot?.replaceChildren(...(editing.has(each.key) ? [] : [editButton(tab, each)]));
  setEditing(box, editing.has(each.key));
  if (editing.has(each.key)) box.append(editorOf(each.key, box));
  else box.append(body(each.key, each.part));
  return box;
}

// What a card shows: Strengths as rows of tags; any other part its lines (a list when several), its table rows, its notes small.
function body(key, part) {
  if (key === 'surveys') return surveyBody(part, {sorting});
  const box = el('div', 'exp-part-body');
  if (isEmpty(part)) { box.append(el('p', 'muted', 'Not set yet.')); return box; }
  if (key === 'strengths') {
    for (const group of groupsOf(part)) {
      if (!group.label) { box.append(el('p', '', group.items[0])); continue; }
      const row = el('div', 'exp-part-group');
      row.append(el('b', '', group.label), chipLine(group.items));   // values as chips (design system: several from a list)
      box.append(row);
    }
    return box;
  }
  const notes = part.lines.filter(line => isNote(line.text)), lines = part.lines.filter(line => !isNote(line.text));
  if (key === 'education' && lines.some(line => fieldsOf(line.text))) {   // entries in Degree · School · Years: the degree bold, the rest under it
    for (const line of lines) {
      const fields = fieldsOf(line.text), entry = el('div', 'edu-read');
      entry.append(...(fields ? [el('b', '', fields.degree || fields.school), ...[fields.degree && fields.school, fields.years].filter(Boolean).map(text => el('span', 'muted', text))] : [el('span', '', shownText(line.text))]));
      box.append(entry);
    }
    lines.length = 0;
  }
  if (lines.length === 1) box.append(el('p', '', shownText(lines[0].text)));
  else if (lines.length) { const list = el('ul', 'exp-part-list'); list.append(...lines.map(line => el('li', '', shownText(line.text)))); box.append(list); }
  if (part.rows.length) box.append(el('p', '', previewOf({lines: [], rows: part.rows})));
  for (const note of notes) box.append(el('p', 'muted small', shownText(note.text).replace(/^\(|\)$/g, '')));
  return box;
}

// The card's editor (renderer/experience-editors.js), made once when Edit is pressed and kept until the bar saves or discards it, so a redraw never
// drops a draft. Nothing is saved here: the card is a source of the Profile's one save bar (pages/profile-save-bar.js); the shell's Done leaves
// an editor that holds no change (a card has no Save or Cancel of its own).
function startEdit(tab, each) {
  const {key, title, part} = each, onChange = () => { sources.get(key)?.changed(); editors.get(key)?.sync?.(); };
  const editor = key === 'surveys' ? surveyEditor(part, onChange) : EDITORS[key] ? EDITORS[key](part, {onChange}) : linesEditor(key, title, part, {onChange});
  editors.set(key, {...editor, tab, items: outlines[tab]});
  editing.add(key);
  folded.set(key, true);
  if (!sources.has(key)) {
    sources.set(key, profileBar().register({id: `profile-${key}`, tab: tab === 'details' ? 'details' : 'experience', label: title,
      count: () => (editors.has(key) ? editors.get(key).changes().length : 0), save: () => saveProfile(key), discard: () => stop(key)}));
  }
  draw(tab);
}
const EDITORS = {summary: summaryEditor, strengths: strengthsEditor, education: educationEditor};
function surveyEditor(part, onChange) {
  const form = surveyForm(part, {onChange});
  return {node: form.node, changes: () => changesFor('surveys', part, form.texts())};
}
function stop(key) {
  const tab = editors.get(key)?.tab;
  editors.delete(key);
  editing.delete(key);
  if (tab) draw(tab);
}

// Every changed card's changes in ONE write of the Profile (on this Mac a line's id is its place: a second write would miss lines the first one moved).
// The bar asks each changed card in turn: the first starts the write, each of the others takes the same answer once.
let round = null;   // {keys: the cards in the write, answer}
function saveProfile(key) {
  if (round?.keys.delete(key)) return round.answer;
  const open = [...editors.entries()].filter(([, editor]) => editor.changes().length);
  round = {keys: new Set(open.map(([each]) => each).filter(each => each !== key)), answer: write(open)};
  return round.answer;
}
async function write(open) {
  if (!open.length) return {ok: true};
  // Another card's save in the same press (Your details) may have moved this Mac's line ids: each editor's changes are found again on a fresh read.
  const fresh = await window.pilot.textOutline('profile').catch(() => null);
  const changes = open.flatMap(([, editor]) => (fresh?.items && editor.items ? rebaseChanges(editor.changes(), editor.items, fresh.items) : editor.changes()));
  const result = await window.pilot.textEdit('profile', changes).catch(error => ({ok: false, error: error.message}));
  const tabs = new Set([...editors.values()].map(editor => editor.tab));
  if (result.ok) for (const key of [...editors.keys()]) { editors.delete(key); editing.delete(key); }   // saved: every editor closes, an unchanged one too
  for (const tab of tabs) {
    if (result.items) setParts(tab, result.items);
    draw(tab);
  }
  if (result.items) keep('profile-parts', {...result, ok: true});
  return result.ok ? {ok: true} : {ok: false, error: result.error || 'couldn\'t save it'};
}

function editorOf(key, card) {
  const editor = editors.get(key);
  const box = el('div', 'exp-part-body is-editing card-editor');
  const done = doneButton(card, () => editor.changes().length);   // the shell's quiet Done, shown only while the card holds no change
  done.addEventListener('click', () => stop(key));
  editor.sync = done.sync;
  box.append(editor.node, done);
  return box;
}
