// Settings → Profile → Your details: the Work eligibility, Availability & compensation and Languages sections (owner, 17 Oct 2026: "Your details =
// facts, in 3 sections"), each line as it is on the Profile page (label, then its value to edit), "Add a line", and "Which is right?" for a fact two
// copies said two ways (lib/profile-move.js). Saved with Contact through the one "Unsaved changes" bar (pages/profile.js). Guarded by
// test/details-facts.test.js.
import {el, loadingCard} from '../components.js';
import {swr} from '../swr.js';
import {$} from './core.js';
import {showOnTab} from './tab-part.js';
import {contactDirty} from './contact-proposals.js';
import {setAsideRows} from './set-aside.js';
import {factOf, factRow} from '../fact-line.js';

export const KEYS = ['eligibility', 'availability', 'languages'];
const box = key => document.querySelector(`[data-facts="${key}"]`);
const PAGE_NAMES = {profile: 'your Profile', answers: 'your standard answers'};

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

// "Tidied": the lines that got their kind on first open, with Undo (lib/details-kinds.js).
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
  box_.replaceChildren(el('p', 'muted small', `${tidied.changed} of your details got a typed control; the words you saved are kept, and the copy from before is backed up.`), undo);
}

function drawWhich(conflicts, aside = [], tidied = null) {
  showOnTab($('setting-which'), conflicts.length > 0 || aside.length > 0 || Boolean(tidied));
  drawTidied(tidied);
  $('facts-set-aside').replaceChildren(...setAsideRows(aside, showFacts, text => { $('facts-message').textContent = text; }));
  $('which-list').replaceChildren(...conflicts.map(conflict => {
    const row = el('div', 'chip-row');
    row.append(el('b', '', conflict.topic.replace(/^./, letter => letter.toUpperCase())));
    conflict.choices.forEach((choice, pick) => {
      const button = el('button', 'secondary', `${choice.value}`);
      button.title = `"${choice.label}" on ${PAGE_NAMES[choice.page] || choice.page}`;
      button.addEventListener('click', async () => {
        button.disabled = true;
        const result = await window.pilot.resolveDetailsConflict(conflict.topic, pick);
        if (result.ok) showFacts(); else { $('facts-message').textContent = result.error; button.disabled = false; }
      });
      row.append(button);
    });
    return row;
  }));
}

// Reads and draws the sections (the first time, the app moves the facts in: copy and backup first, lib/profile-move.js).
export async function showFacts() {
  await swr('details-facts', () => window.pilot.detailsFacts(), {
    loading: () => KEYS.forEach(key => box(key)?.replaceChildren(loadingCard('Reading your details…', [60, 80]))),
    paint: (result, kept) => {
      if (!kept && !$('contact-save').disabled) return;   // a refresh never redraws under unsaved edits
      $('facts-message').textContent = '';
      draw(result.sections || {}, result.formats || {});
      drawWhich(result.conflicts || [], result.setAside || [], result.tidied || null);
    },
    fail: result => { $('facts-message').textContent = result.error || ''; draw({}); },
  });
}

// What the boxes hold now: {eligibility: [{label, value, kind}], ...} (a line with no value is dropped on save).
export function factsNow() {
  return Object.fromEntries(KEYS.map(key => [key, [...(box(key)?.querySelectorAll('.fact-line') || [])].map(factOf).filter(line => line.label && line.value)]));
}
