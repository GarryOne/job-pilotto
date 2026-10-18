// Strategy → "Which locations are right?" (owner, 17 Oct 2026: "Resolve genuine conflicts individually, showing both existing values. Don't preselect a winner."):
// one row per kind where the search settings and the Profile said different places. Each is the shared choice row (page-parts.js choiceRow; owner, 18 Oct
// 2026: "bad UI... no colors"; sketch decision 2, "no winner"): Strategy (violet) and Profile (teal) side by side, the places only one side has outlined,
// two equal buttons in their sides' colours and one quiet "Choose…" menu (type other places, or use different locations for searching). Nothing is picked for the person.
// Guarded by test/locations-which.test.js.
import {el} from '../components.js';
import {$, message} from './core.js';
import {shared} from './shared.js';
import {setAsideRows} from './set-aside.js';
import {titleCase} from '../fragment-words.js';
import {choiceRow} from '../page-parts.js';

export const KIND_NAMES = {preferred: 'Preferred locations', acceptable: 'Acceptable locations', relocation: 'Relocation'};
const MODE_WORDS = {no: 'No relocation', yes: 'Yes', unspecified: 'Not specified'};
const SHOWN = 8;   // a long crawl list (70 places abroad) shows its first places and "+ N more"
// A side as the person reads it: its places in title case, or for relocation what it said when it named none.
export const sideText = (places, mode) => {
  if (!places?.length) return MODE_WORDS[mode] || 'Nothing set';
  const names = [...new Set(places.map(name => (name === name.toLowerCase() ? titleCase(name) : name)))];   // a pattern's lowercase name, never the person's own words
  return names.length > SHOWN ? `${names.slice(0, SHOWN).join(', ')} + ${names.length - SHOWN} more` : names.join(', ');
};

function ask(kind, choice, places = []) {
  return window.pilot.resolveLocationConflict(kind, choice, places);
}

// A side's places as chips, the ones only it has outlined; a side that names none says what it said (relocation: "No relocation").
const names = places => [...new Set((places || []).map(name => (name === name.toLowerCase() ? titleCase(name) : name)))];
function side(who, tone, places, only, mode) {
  const alone = new Set(names(only).map(name => name.toLowerCase()));
  return places?.length ? {who, tone, items: names(places).map(text => ({text, mark: alone.has(text.toLowerCase()) ? 'only' : ''}))} : {who, tone, text: sideText(places, mode)};
}

export function whichRow(conflict, reload) {
  const typed = Object.assign(el('input', 'add'), {placeholder: 'Places, separated by commas', hidden: true});
  const go = (choice, places) => async button => {
    button.disabled = true;
    const result = await ask(conflict.kind, choice, places?.()).catch(error => ({ok: false, error: error.message}));
    if (result.ok) reload(); else { message('locations-which-message', result.error || ''); button.disabled = false; }
  };
  const save = Object.assign(el('button', 'secondary small-btn', 'Save these locations'), {type: 'button', hidden: true});
  save.addEventListener('click', () => go('choose', () => typed.value.split(/\s*,\s*/).filter(Boolean))(save));
  const box = choiceRow({key: conflict.kind, title: KIND_NAMES[conflict.kind] || conflict.kind,
    sides: [side('Strategy', 'violet', conflict.strategy, conflict.onlyStrategy), side('Profile', 'teal', conflict.profile, conflict.onlyProfile, conflict.profileMode)],
    actions: [{label: "Use Strategy's", tone: 'violet', run: go('strategy')}, {label: "Use Profile's", tone: 'teal', run: go('profile')},
      {label: 'Choose…', link: true, menu: [{label: 'Type other places…', run: () => { typed.hidden = false; save.hidden = false; typed.focus(); }},
        {label: 'Use different locations for searching', run: () => go('separate')({}), title: 'Searches the Strategy places; scoring and the card use the Profile ones.'}]}]});
  box.classList.add('which-row');
  box.dataset.kind = conflict.kind;
  const pick = el('div', 'choice-typed');
  pick.append(typed, save);
  box.append(pick);
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
  $('locations-which-list').replaceChildren(...conflicts.map(conflict => whichRow(conflict, loadLocationsWhich)));
}
