// Settings → Profile → Your details: the Work eligibility, Availability & compensation and Languages sections (owner, 17 Oct 2026: "Your details =
// facts, in 3 sections"), each line as it is on the Profile page (label, then its value to edit), "Add a line", and "To check": one line counting the
// unclear details (a fact said two ways, a line with no clear home, a value to make exact, an unanswered mark) that opens the one review queue (owner, 18 Oct 2026:
// "One queue for all"; lib/details-review.js). Saved through the Profile page's one save bar (pages/details-drafts.js), except a live section (LIVE_KEYS:
// Languages, the live-cards pilot) whose every change saves on the spot with Undo (live-save.js). Guarded by test/details-facts.test.js,
// test/details-review.test.js and test/details-read.test.js.
import {el, loadingCard} from '../components.js';
import {keep, swr} from '../swr.js';
import {$} from './core.js';
import {showOnTab} from './tab-part.js';
import {LIVE_KEYS, detailsChanged, factsDirty, factsRead, liveFacts} from './details-drafts.js';
import {liveCard} from '../live-save.js';
import {setAsideRows} from './set-aside.js';
import {factOf, factRow} from '../fact-line.js';
import {detailsIn} from '../question-filter.js';
import {loadQuestions, questionsNow} from './jobs-questions.js';

export const KEYS = ['eligibility', 'availability', 'languages'];
const box = key => document.querySelector(`[data-facts="${key}"]`);
const readBox = key => document.querySelector(`[data-facts-read="${key}"]`);   // the card's read view (pages/details-read.js)
// The skeleton stands in the editor and in the read view until the lines are read; a read view marked loading is not redrawn as "Nothing yet".
function skeletons(on) {
  for (const key of KEYS) {
    const read = readBox(key);
    if (on) box(key)?.replaceChildren(loadingCard('Reading your details…', [60, 80]));
    if (!read) continue;
    if (on) { read.dataset.loading = '1'; read.replaceChildren(loadingCard('Reading your details…', [60, 80])); } else delete read.dataset.loading;
  }
}

// A line of a live section (LIVE_KEYS, live-save.js): each change saves the section; Undo redraws the row as it was last saved, and that is saved too.
function liveRow(key, line, formats) {
  let row = null;
  row = factRow(key, line, formats, () => {
    const before = row.savedLine;
    liveFacts().changed(row, () => { const back = liveRow(key, before, formats); row.replaceWith(back); return back; });
  });
  row.savedLine = line;
  row.addEventListener('live-saved', () => { row.savedLine = factOf(row); });
  const check = [...row.children].find(node => node.classList?.contains('ui-pill'));
  if (check) row.querySelector('.qa-values')?.append(check);   // the "Check" chip on the value's line, never alone under it
  return row;
}

let liveHooked = false;
function draw(sections, formats = {}) {
  for (const key of KEYS) {
    const into = box(key);
    if (!into) continue;
    const live = LIVE_KEYS.includes(key);
    if (live && !liveHooked) { liveHooked = true; liveCard(into, liveFacts()); }
    const row = line => (live ? liveRow(key, line, formats) : factRow(key, line, formats, () => detailsChanged()));
    const add = el('button', 'link span-all', live ? '+ Add a language' : '+ Add a line');
    add.type = 'button';
    add.addEventListener('click', () => { into.insertBefore(row({}), add); if (!live) detailsChanged(); });
    into.replaceChildren(...(sections[key] || []).map(row), add);
  }
}

// "Tidied": the lines that got their kind, or their note for the AI, on first open, with Undo (lib/details-kinds.js, lib/details-notes.js).
function drawTidied(tidied) {
  const box_ = $('facts-tidied');
  if (!tidied) { box_.replaceChildren(); return; }
  const undo = el('button', 'secondary', 'Undo');
  undo.type = 'button';
  undo.addEventListener('click', async () => {
    undo.disabled = true;
    const result = await window.pilot.undoDetailsTidy();
    if (result.ok) showFacts(); else { $('facts-message').textContent = result.error; undo.disabled = false; }
  });
  box_.replaceChildren(el('p', 'muted small', `${tidied.changed} of your details were tidied: a typed control, or the rules folded as a note for the AI. The words you saved are kept, and the copy from before is backed up.`), undo);
}

// "To check": the review queue's Your details items, counted from the queue's own list (read once when Jobs has not read it yet), Review opens it at the first.
let last = {aside: [], tidied: null}, queueAsked = false;
document.addEventListener?.('questions-read', () => drawWhich(last.aside, last.tidied));
function drawWhich(aside = [], tidied = null) {
  last = {aside, tidied};
  if (!questionsNow().read && !queueAsked) { queueAsked = true; loadQuestions().then(() => drawWhich(last.aside, last.tidied)).catch(() => {}); }
  const items = detailsIn(questionsNow().list);
  showOnTab($('setting-which'), items.length > 0 || aside.length > 0 || Boolean(tidied));
  drawTidied(tidied);
  $('facts-set-aside').replaceChildren(...setAsideRows(aside, showFacts, text => { $('facts-message').textContent = text; }));
  if (!items.length) { $('which-list').replaceChildren(); return; }
  const banner = el('div', 'notice qa-banner');
  const go = Object.assign(el('button', 'primary small-btn', 'Review'), {type: 'button', id: 'details-review-go'});
  go.addEventListener('click', () => import('./question-review.js').then(review => review.openQuestionReview({start: items[0].key})));
  banner.append(el('span', '', `⚠ ${items.length} detail${items.length === 1 ? '' : 's'} to check`), go);
  $('which-list').replaceChildren(banner);
}

// Reads and draws the sections: the saved lines at once (lib/details-facts-handlers.js 'detailsFactsNow'), then the one-time moves settle in the background (the first time the app
// moves the facts in: copy and backup first, lib/profile-move.js) and the screen draws again with what they did. 'details-sorting' tells the cards (the Voluntary surveys card
// shows "Sorting your answers…", then reads its lines again); the first paint never waits on an AI call. Guarded by test/details-facts.test.js.
let settledFor = 0, redrawing = false;
const paintFacts = (result, kept) => {
  skeletons(false);
  if (!kept && !redrawing && factsDirty()) return;   // a refresh never redraws under unsaved edits (Discard all redraws on purpose)
  $('facts-message').textContent = '';
  draw(result.sections || {}, result.formats || {});
  factsRead();   // the drafts count from what is drawn now (details-drafts.js)
  drawWhich(result.setAside || [], result.tidied || null);
};
export async function showFacts({redraw = false} = {}) {
  const turn = ++settledFor;
  redrawing = redraw;
  const quick = await swr('details-facts', () => window.pilot.detailsFactsNow(), {
    loading: () => skeletons(true),
    paint: paintFacts,
    fail: result => { $('facts-message').textContent = result.error || ''; skeletons(false); draw({}); detailsChanged(); },
  });
  document.dispatchEvent(new CustomEvent('details-sorting', {detail: {on: true}}));
  const settled = await window.pilot.detailsFacts().catch(error => ({ok: false, error: error.message}));
  if (turn === settledFor && settled?.ok !== undefined) {
    if (settled.ok) { keep('details-facts', settled); paintFacts(settled, false); } else if (settled.error) $('facts-message').textContent = settled.error;
  }
  redrawing = false;
  document.dispatchEvent(new CustomEvent('details-sorting', {detail: {on: false, changed: settled?.changed || 0}}));
  return quick;
}

// What the boxes hold now: {eligibility: [{label, value, kind}], ...} (a line with no value is dropped on save).
export function factsNow() {
  return Object.fromEntries(KEYS.map(key => [key, [...(box(key)?.querySelectorAll('.fact-line') || [])].map(factOf).filter(line => line.label && line.value)]));
}
