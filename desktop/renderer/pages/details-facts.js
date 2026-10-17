// Settings → Profile → Your details: the Work eligibility, Availability & compensation and Languages sections (owner, 17 Oct 2026: "Your details =
// facts, in 3 sections"), each line as it is on the Profile page (label, then its value to edit), "Add a line", and "Which is right?" for a fact two
// copies said two ways (lib/profile-move.js). Saved with Contact through the one "Unsaved changes" bar (pages/profile.js). Guarded by
// test/details-facts.test.js.
import {el} from '../components.js';
import {$, show} from './core.js';
import {contactDirty} from './contact-proposals.js';

export const KEYS = ['eligibility', 'availability', 'languages'];
const box = key => document.querySelector(`[data-facts="${key}"]`);
const PAGE_NAMES = {profile: 'your Profile', answers: 'your standard answers'};

function lineField(key, {label = '', value = ''} = {}) {
  const row = el('label', 'fact-line');
  const name = Object.assign(document.createElement('input'), {type: 'text', value: label, placeholder: 'What (e.g. Notice period)'});
  const input = Object.assign(document.createElement('input'), {type: 'text', value, placeholder: 'Your answer'});
  name.dataset.factLabel = key;
  input.dataset.factValue = key;
  // A line read from the Profile keeps its words as its label; a new one is named by you.
  if (label) { name.hidden = true; row.append(el('span', '', label)); }
  for (const each of [name, input]) each.addEventListener('input', () => contactDirty(true));
  row.append(name, input);
  return row;
}

function draw(sections) {
  for (const key of KEYS) {
    const into = box(key);
    if (!into) continue;
    const add = el('button', 'link span-all', '+ Add a line');
    add.type = 'button';
    add.addEventListener('click', () => { into.insertBefore(lineField(key), add); contactDirty(true); });
    into.replaceChildren(...(sections[key] || []).map(line => lineField(key, line)), add);
  }
}

function drawWhich(conflicts) {
  show($('setting-which'), conflicts.length > 0);
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
  const result = await window.pilot.detailsFacts().catch(error => ({ok: false, error: error.message}));
  $('facts-message').textContent = result.ok ? '' : result.error || '';
  draw(result.sections || {});
  drawWhich(result.conflicts || []);
}

// What the boxes hold now: {eligibility: [{label, value}], ...} (a line with no value is dropped on save).
export function factsNow() {
  return Object.fromEntries(KEYS.map(key => [key, [...(box(key)?.querySelectorAll('.fact-line') || [])].map(row => ({
    label: row.querySelector('[data-fact-label]').value.trim(), value: row.querySelector('[data-fact-value]').value.trim()})).filter(line => line.label && line.value)]));
}
