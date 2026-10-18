// Strategy → "Which locations are right?" (owner, 17 Oct 2026: "Resolve genuine conflicts individually, showing both existing values. Don't preselect a winner."):
// one row per kind where the search settings and the Profile said different places: the two sides as equal boxes (Use Strategy's / Use Profile's), then
// one quiet "Choose…" menu (Other places…, Search with Strategy's, score with Profile's). Nothing is picked for the person. Guarded by test/locations-which.test.js.
import {chip, el, openMenu} from '../components.js';
import {$, message} from './core.js';
import {shared} from './shared.js';
import {setAsideRows} from './set-aside.js';
import {titleCase} from '../fragment-words.js';

export const KIND_NAMES = {preferred: 'Preferred locations', acceptable: 'Acceptable locations', relocation: 'Relocation'};
const MODE_WORDS = {no: 'No relocation', yes: 'Yes', unspecified: 'Not specified'};
const SHOWN = 10;   // a long crawl list (70 places abroad) shows its first places and "+N more"
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

// One side's places as chips, those only this side has in its colour (owner, 18 Oct 2026: "a choice shows only the difference"); a long list shows its
// first places and "+N more", opening in place; a relocation side that named none says what it said.
function sideChips(places, mode, only, tone) {
  const box = el('div', 'chips which-chips');
  const names = [...new Set((places || []).map(name => (name === name.toLowerCase() ? titleCase(name) : name)))];
  if (!names.length) { box.append(el('span', 'muted', MODE_WORDS[mode] || 'Nothing set')); return box; }
  const alone = new Set((only || []).map(name => String(name).toLowerCase()));
  const chipOf = name => chip(name, {tone: alone.has(name.toLowerCase()) ? tone : ''});
  box.append(...names.slice(0, SHOWN).map(chipOf));
  if (names.length > SHOWN) {
    const more = Object.assign(el('button', 'link chip-more', `+${names.length - SHOWN} more`), {type: 'button'});
    more.addEventListener('click', () => more.replaceWith(...names.slice(SHOWN).map(chipOf)));
    box.append(more);
  }
  return box;
}

// One conflict: its name in the label column, then the two sides as equal boxes, no winner picked (violet = Strategy, teal = Profile), each with its own
// "Use …" button; beside them one quiet "Choose…" menu: other places, or search one list and score the other.
function row(conflict, reload) {
  const box = el('div', 'which-row');
  box.dataset.kind = conflict.kind;
  const go = (choice, places) => async event => {
    const button = event.currentTarget;
    button.disabled = true;
    const result = await ask(conflict.kind, choice, places?.()).catch(error => ({ok: false, error: error.message}));
    if (result.ok) reload(); else { message('locations-which-message', result.error || ''); button.disabled = false; }
  };
  const button = (label, className, handler) => { const node = el('button', className, label); node.type = 'button'; node.addEventListener('click', handler); return node; };
  const option = (side, label, places, mode, only, tone, use) => {
    const card = el('div', `which-option tone-${tone}`);
    card.dataset.side = side;
    card.append(el('span', 'which-side', label), sideChips(places, mode, only, tone), button(`Use ${label}'s`, 'secondary which-use', use));
    return card;
  };
  const options = el('div', 'which-options');
  options.append(option('strategy', 'Strategy', conflict.strategy, '', conflict.onlyStrategy, 'violet', go('strategy')),
    option('profile', 'Profile', conflict.profile, conflict.profileMode, conflict.onlyProfile, 'teal', go('profile')));
  // The other ways out: one quiet "Choose…" menu beside the two boxes, never a line of links under them (owner: no lone line under a list).
  const typed = Object.assign(el('input', 'add'), {placeholder: 'Places, separated by commas', hidden: true});
  typed.setAttribute('aria-label', `${KIND_NAMES[conflict.kind] || conflict.kind}: places`);
  const save = button('Save these places', 'secondary small-btn', go('choose', () => typed.value.split(/\s*,\s*/).filter(Boolean)));
  save.hidden = true;
  const choose = button('Choose…', 'secondary which-choose', event => openMenu(event.currentTarget, [
    {label: 'Other places…', run: () => { typed.hidden = false; save.hidden = false; choose.hidden = true; typed.focus(); }},
    {label: 'Search with Strategy\'s, score with Profile\'s', run: () => go('separate')({currentTarget: choose})}]));
  choose.setAttribute('aria-haspopup', 'menu');
  choose.title = 'Other places, or search with the Strategy places and score with the Profile ones';
  options.append(choose);
  const body = el('div', 'which-body');
  body.append(options);
  const more = el('div', 'which-more');
  more.append(typed, save);
  body.append(more);
  box.append(el('b', 'which-label', KIND_NAMES[conflict.kind] || conflict.kind), body);
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
