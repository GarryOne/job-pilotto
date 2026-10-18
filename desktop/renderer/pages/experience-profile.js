// Settings → Profile: the Profile page's own sections as folded cards with Edit (owner, 17 Oct 2026: "It should be properly formatted. It should be
// collapsed, it should be using cards"). Experience: summary and strengths open, education and any section the app does not know folded; Strengths
// as one row per "Label:" with its values as tags; a heading's "(…)" note and lines in brackets shown small. The role history is drawn by the job
// cards, never here. Your details: the voluntary survey answers. Read from the Profile's outline and saved block by block on every store (IPC
// textOutline / textEdit); the model is renderer/experience-profile-model.js. Cards are the Application answers' folds (.answer-item.qa-fold).
// Guarded by test/experience-profile.test.js and test/experience-cards.test.js.
import {cardEdit, el, loadingCard, tag} from '../components.js';
import {keep, swr} from '../swr.js';
import {icon} from '../icons.js';
import {$, message} from './core.js';
import {surveyBody, surveyForm} from '../survey-rows.js';
import {gapsBody} from '../gaps-rows.js';
import {setState} from '../gaps-model.js';
import {changesFor, groupsOf, isEmpty, isNote, partsOn, previewOf, profileParts, shownText, unset} from '../experience-profile-model.js';

// Where each tab draws its parts: the box and its message line in index.html.
const BOXES = {experience: ['exp-profile', 'exp-profile-message'], details: ['details-profile', 'details-profile-message']};
const OPEN_FIRST = new Set(['summary', 'strengths']);   // shown open until the person folds them (owner, 17 Oct 2026)
const parts = {};
const folded = new Map();   // part key → open (true) or folded (false), as the person left it
const editing = new Set();
let gapsTidied = null, gapsAsked = false;   // the one-time CV gaps split: what it did (for Undo), and whether this window asked yet

export async function loadExperienceProfile(tab = 'experience') {
  const [boxId, messageId] = BOXES[tab];
  if (!$(boxId)) return;
  const box = $(boxId);
  await swr('profile-parts', () => window.pilot.textOutline('profile'), {
    loading: () => box.replaceChildren(loadingCard('Reading your Profile…')),
    paint: (result, kept) => { if (kept || !editing.size) { parts[tab] = profileParts(result.items); draw(tab); if (tab === 'experience') splitGaps(tab); } },   // a refresh never redraws a card under edit
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
  if (fresh?.items) { parts[tab] = profileParts(fresh.items); keep('profile-parts', {...fresh, ok: true}); draw(tab); }
}
// A chip pressed: ✓ a confirmed skill, ✕ not a gap, Undo back to "to check": that one line is rewritten in the store.
async function pressGap(tab, part, item, state) {
  const was = part.lines.find(line => line.id === item.id)?.text;
  if (was === undefined) return;
  const result = await window.pilot.textEdit('profile', [{op: 'text', id: item.id, value: setState(was, state), was}]).catch(error => ({ok: false, error: error.message}));
  if (result.items) { parts[tab] = profileParts(result.items); keep('profile-parts', {...result, ok: true}); draw(tab); }
  if (!result.ok) message(BOXES[tab][1], result.error, 'error');
}
async function undoGaps(tab) {
  const result = await window.pilot.undoCvGaps().catch(error => ({ok: false, error: error.message}));
  if (result.ok) { gapsTidied = null; await reread(tab); } else message(BOXES[tab][1], result.error, 'error');
}

function draw(tab) {
  const list = partsOn(parts[tab], tab);
  // A panel with one part (Your details' Voluntary surveys) already says its name: no card around it.
  $(BOXES[tab][0]).replaceChildren(...list.map(each => (list.length === 1 ? solo(tab, each) : card(tab, each))));
}

// The card's Edit/Add: the shared header button (components.js cardEdit), at the right of the title line.
const editButton = (tab, each) => {
  const empty = isEmpty(each.part);
  return cardEdit(empty ? 'Add' : 'Edit', each.title.toLowerCase(), event => { event.preventDefault(); editing.add(each.key); folded.set(each.key, true); draw(tab); });
};

function card(tab, each) {
  const {key, title, part} = each;
  const box = el('details', 'answer-item qa-section qa-fold exp-part');
  box.dataset.part = key;
  box.open = folded.has(key) ? folded.get(key) : OPEN_FIRST.has(key) || editing.has(key);
  box.addEventListener('toggle', () => folded.set(key, box.open));
  const head = el('summary', 'qa-section-head');
  const count = key === 'strengths' ? part?.lines.length : 0;
  head.append(icon('file-text'), el('h4', '', title), ...(part?.note ? [el('span', 'muted small', part.note)] : []), ...(count ? [el('span', 'muted small', String(count))] : []),
    el('span', 'exp-part-gap'), editButton(tab, each));
  box.append(head, editing.has(key) ? editor(tab, each) : key === 'gaps' ? gapsBody(part, (item, state) => pressGap(tab, part, item, state), {tidied: gapsTidied, onUndo: () => undoGaps(tab)}) : body(key, part));
  return box;
}

// A panel with one part: its title is the panel's own (index.html), so the button goes in that title line (the slot next to it).
function solo(tab, each) {
  const box = el('div', 'exp-part'), slot = $(`${BOXES[tab][0]}-edit`);
  box.dataset.part = each.key;
  slot?.replaceChildren(...(editing.has(each.key) ? [] : [editButton(tab, each)]));
  if (editing.has(each.key)) box.append(editor(tab, {...each, solo: true}));
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
      const row = el('div', 'exp-part-group'), tags = el('div', 'tags');
      tags.append(...group.items.map(item => tag(item)));
      row.append(el('b', '', group.label), tags);
      box.append(row);
    }
    return box;
  }
  const notes = part.lines.filter(line => isNote(line.text)), lines = part.lines.filter(line => !isNote(line.text));
  if (lines.length === 1) box.append(el('p', '', shownText(lines[0].text)));
  else if (lines.length) { const list = el('ul', 'exp-part-list'); list.append(...lines.map(line => el('li', '', shownText(line.text)))); box.append(list); }
  if (part.rows.length) box.append(el('p', '', previewOf({lines: [], rows: part.rows})));
  for (const note of notes) box.append(el('p', 'muted small', shownText(note.text).replace(/^\(|\)$/g, '')));
  return box;
}

// One input per line (a paragraph or a bullet) and one per table cell; "+ Add a line"; Save writes only what changed.
function editor(tab, each) {
  const {key, title, part} = each;
  const box = el('div', 'exp-part-body is-editing');
  const form = key === 'surveys' ? surveyForm(part) : null;   // the survey questions, each with its fixed list (renderer/survey-rows.js)
  const lines = form ? form.node : el('div', 'exp-part-lines');
  const line = text => {
    const input = Object.assign(el('input', ''), {type: 'text', value: text.replace(/\*\*/g, '')});   // one line each, never a textarea (owner, 16 Oct 2026)
    input.dataset.partLine = key;
    input.setAttribute('aria-label', title);
    return input;
  };
  const rows = (part?.rows || []).map(row => {
    const cells = el('div', 'exp-part-row');
    cells.append(...row.cells.map((cell, index) => Object.assign(el('input', ''), {type: 'text', value: unset(cell) ? '' : cell, ariaLabel: `${title} ${index + 1}`})));
    return cells;
  });
  if (!form) lines.append(...rows, ...(part?.lines.length ? part.lines.map(each => line(each.text)) : rows.length ? [] : [line('')]));
  const add = Object.assign(el('button', 'link', '+ Add a line'), {type: 'button'});
  add.addEventListener('click', () => lines.append(line('')));
  const save = Object.assign(el('button', 'primary', 'Save'), {type: 'button'});
  const cancel = Object.assign(el('button', 'secondary', 'Cancel'), {type: 'button'});
  const actions = el('div', 'inline');
  actions.append(save, cancel, ...(form ? [] : [add]));
  cancel.addEventListener('click', () => { editing.delete(key); draw(tab); });
  save.addEventListener('click', async () => {
    // A line whose words did not change keeps its own text (its bold, its list mark): only an edited line is rewritten.
    const texts = form ? form.texts() : [...lines.querySelectorAll('input[data-part-line]')].map((input, i) => {
      const was = part?.lines[i]?.text;
      return was !== undefined && input.value.trim() === was.replace(/\*\*/g, '').trim() ? was : input.value;
    });
    const cells = rows.map((row, i) => [...row.querySelectorAll('input')].map((input, index) => (input.value.trim() === '' && unset(part.rows[i].cells[index]) ? part.rows[i].cells[index] : input.value)));
    const changes = changesFor(key, part, texts, cells);
    if (!changes.length) { editing.delete(key); draw(tab); return; }
    save.disabled = true;
    const result = await window.pilot.textEdit('profile', changes).catch(error => ({ok: false, error: error.message}));
    if (result.items) { parts[tab] = profileParts(result.items); keep('profile-parts', {...result, ok: true}); }
    message(BOXES[tab][1], result.ok ? 'Saved ✓ The next tailored CVs, letters and scores use it.' : result.error, result.ok ? 'ok' : 'error');
    if (result.ok) editing.delete(key);
    if (result.ok || result.items) draw(tab); else save.disabled = false;
  });
  box.append(lines, actions);
  return box;
}
