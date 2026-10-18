// Settings → Profile → Your details: the Work eligibility, Availability & compensation and Languages sections (owner, 17 Oct 2026: "Your details =
// facts, in 3 sections"), each line as it is on the Profile page (label, then its value to edit), "Add a line", and "To check": one line counting the
// unclear details (a fact said two ways, a line with no clear home, a value to make exact, an unanswered mark) that opens the one review queue (owner, 18 Oct 2026:
// "One queue for all"; lib/details-review.js). Saved with Contact through the one "Unsaved changes" bar (pages/profile.js). Guarded by
// test/details-facts.test.js and test/details-review.test.js.
import {el, loadingCard} from '../components.js';
import {swr} from '../swr.js';
import {$} from './core.js';
import {showOnTab} from './tab-part.js';
import {contactDirty} from './contact-proposals.js';
import {setAsideRows} from './set-aside.js';
import {factOf, factRow} from '../fact-line.js';
import {detailsIn} from '../question-filter.js';
import {loadQuestions, questionsNow} from './jobs-questions.js';

export const KEYS = ['eligibility', 'availability', 'languages'];
const box = key => document.querySelector(`[data-facts="${key}"]`);

function draw(sections, formats = {}) {
  for (const key of KEYS) {
    const into = box(key);
    if (!into) continue;
    const add = el('button', 'link span-all', '+ Add a line');
    add.type = 'button';
    add.addEventListener('click', () => { into.insertBefore(factRow(key, {}, formats, () => contactDirty(true)), add); contactDirty(true); });
    into.replaceChildren(...(sections[key] || []).map(line => factRow(key, line, formats, () => contactDirty(true))), add);
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

// Reads and draws the sections (the first time, the app moves the facts in: copy and backup first, lib/profile-move.js).
export async function showFacts() {
  await swr('details-facts', () => window.pilot.detailsFacts(), {
    loading: () => KEYS.forEach(key => box(key)?.replaceChildren(loadingCard('Reading your details…', [60, 80]))),
    paint: (result, kept) => {
      if (!kept && !$('contact-save').disabled) return;   // a refresh never redraws under unsaved edits
      $('facts-message').textContent = '';
      draw(result.sections || {}, result.formats || {});
      drawWhich(result.setAside || [], result.tidied || null);
    },
    fail: result => { $('facts-message').textContent = result.error || ''; draw({}); },
  });
}

// What the boxes hold now: {eligibility: [{label, value, kind}], ...} (a line with no value is dropped on save).
export function factsNow() {
  return Object.fromEntries(KEYS.map(key => [key, [...(box(key)?.querySelectorAll('.fact-line') || [])].map(factOf).filter(line => line.label && line.value)]));
}
