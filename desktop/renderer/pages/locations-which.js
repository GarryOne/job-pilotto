// Strategy → "Which locations are right?" (owner, 17 Oct 2026: "Resolve genuine conflicts individually, showing both existing values. Don't preselect a winner."):
// one row per kind where the search settings and the Profile said different places. Use Profile value / Use Strategy value / Choose locations, and under
// Advanced "Use different locations for searching". Nothing is picked for the person. Guarded by test/locations-which.test.js.
import {el} from '../components.js';
import {$, message} from './core.js';
import {shared} from './shared.js';
import {setAsideRows} from './set-aside.js';
import {titleCase} from '../fragment-words.js';

export const KIND_NAMES = {preferred: 'Preferred locations', acceptable: 'Acceptable locations', relocation: 'Relocation'};
const MODE_WORDS = {no: 'No relocation', yes: 'Yes', unspecified: 'Not specified'};
const SHOWN = 8;   // a long crawl list (70 places abroad) shows its first places and "+ N more"
// A side as the person reads it: its places in title case, or for relocation what it said when it named none.
export const sideText = (places, mode) => {
  if (!places?.length) return MODE_WORDS[mode] || 'Nothing set';
  const names = [...new Set(places.map(name => (name === name.toLowerCase() ? titleCase(name) : name)))];   // a pattern's lowercase name, never the person's own words
  return names.length > SHOWN ? `${names.slice(0, SHOWN).join(', ')} + ${names.length - SHOWN} more` : names.join(', ');
};
// What only one side has, from the same-meaning check (lib/locations-same.js), in the same words.
export const differs = conflict => [['Only in Strategy', conflict.onlyStrategy], ['Only in Profile', conflict.onlyProfile]]
  .filter(([, list]) => list?.length).map(([label, list]) => `${label}: ${sideText(list)}`);

function ask(kind, choice, places = []) {
  return window.pilot.resolveLocationConflict(kind, choice, places);
}

function row(conflict, reload) {
  const box = el('div', 'which-row');
  box.dataset.kind = conflict.kind;
  box.append(el('b', '', KIND_NAMES[conflict.kind] || conflict.kind),
    el('p', 'muted small', `Strategy: ${sideText(conflict.strategy)}`), el('p', 'muted small', `Profile: ${sideText(conflict.profile, conflict.profileMode)}`),
    ...differs(conflict).map(line => el('p', 'small', line)));
  const buttons = el('div', 'chip-row');
  const typed = Object.assign(el('input', 'add'), {placeholder: 'Places, separated by commas', hidden: true});
  const go = (choice, places) => async event => {
    const button = event.currentTarget;
    button.disabled = true;
    const result = await ask(conflict.kind, choice, places?.()).catch(error => ({ok: false, error: error.message}));
    if (result.ok) reload(); else { message('locations-which-message', result.error || ''); button.disabled = false; }
  };
  const add = (label, handler, parent = buttons) => { const button = el('button', 'secondary', label); button.type = 'button'; button.addEventListener('click', handler); parent.append(button); return button; };
  add('Use Profile value', go('profile'));
  add('Use Strategy value', go('strategy'));
  const choose = add('Choose locations', () => { typed.hidden = false; typed.focus(); save.hidden = false; choose.hidden = true; });
  const save = add('Save these locations', go('choose', () => typed.value.split(/\s*,\s*/).filter(Boolean)));
  save.hidden = true;
  box.append(buttons, typed);
  const more = el('details', 'which-advanced');
  more.append(el('summary', 'muted small', 'Advanced'));
  add('Use different locations for searching', go('separate'), more);
  more.append(el('p', 'muted small', 'Searches the Strategy places; scoring and the card use the Profile ones.'));
  box.append(more);
  return box;
}

// Reads the conflicts (the first time, the app moves the Profile's places in: copy and backup first) and draws them; the card is hidden with none.
export async function loadLocationsWhich() {
  const card = $('strategy-locations-which');
  if (!card) return;
  const result = await window.pilot.locationsWhich().catch(error => ({ok: false, error: error.message}));
  const conflicts = result.conflicts || [];
  shared.locationsOpen = conflicts.length > 0;   // ⌘K lists "Which locations are right?" only while one is open
  const aside = result.setAside || [];
  card.hidden = !conflicts.length && !aside.length;
  message('locations-which-message', result.ok ? '' : result.error || '');
  $('locations-set-aside').replaceChildren(...setAsideRows(aside, loadLocationsWhich, text => message('locations-which-message', text)));
  $('locations-which-list').replaceChildren(...conflicts.map(conflict => row(conflict, loadLocationsWhich)));
}
