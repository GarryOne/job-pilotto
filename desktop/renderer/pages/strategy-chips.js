// Strategy's chips as read (not editing), owner's decisions of 17 Oct 2026: one chip per meaning ("United States · USA, US", the other spellings
// kept inside it and still searched), a typo flagged as "Did you mean …? Fix · Keep" (never fixed silently), whole-word entries as their own group
// and a Google Jobs place read as a place (renderer/match-groups.js, from the design system's PR B). The meanings come from lib/list-meanings.js (AI, cached by the lists).
// chipsOf / folded moved here from strategy-targets.js (a pure move). Pure rules in ../chip-meanings.js. Guarded by test/strategy-chips.test.js.
import {chip as valueChip, el} from '../components.js';
import {titleCase} from '../fragment-words.js';
import {strategyState} from './strategy-state.js';
import {MEANING_LISTS, meaningLabels as groupLabels} from '../chip-meanings.js';

// A chip (components.js chip()): a word, or {main, others} for one meaning with its other spellings as the muted detail.
function chip(label, cased) {
  const words = text => (cased ? titleCase(text) : text);
  return typeof label === 'string' ? valueChip(words(label)) : valueChip(words(label.main), {detail: label.others.map(words).join(', ')});
}
export const chipsOf = (labels, cased = true) => {
  const box = el('div', 'chip-list');
  box.append(...labels.map(label => chip(label, cased)));
  return box;
};
// A few chips, the rest behind a toggle ("View title variants", "Show all"): nothing is dropped, only folded.
export function folded(labels, keep, more) {
  const box = chipsOf(labels.slice(0, keep));
  if (labels.length <= keep) return box;
  const rest = labels.slice(keep), toggle = el('button', 'link chip-more', `${more} (${rest.length})`);
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.addEventListener('click', () => { toggle.replaceWith(...rest.map(label => chip(label, true))); });
  box.append(toggle);
  return box;
}

// One list's labels, one chip per meaning (chip-meanings.js), from the meanings loaded below.
export const meaningLabels = (name, labels) => groupLabels(strategyState.meanings?.[name]?.groups, labels);

// "Did you mean …?" lines for one list's typos the person has not kept. fix(entry, suggestion, button) / keep(entry) do the work and redraw.
export function typoHints(name, {fix, keep}) {
  const kept = new Set(strategyState.keptTypos || []);
  const typos = (strategyState.meanings?.[name]?.typos || []).filter(typo => !kept.has(typo.entry));
  return typos.map(typo => {
    const line = el('span', 'muted small');
    const button = (label, run) => { const b = el('button', 'link', label); b.type = 'button'; b.addEventListener('click', () => { b.disabled = true; run(b); }); return b; };
    line.append(`"${typo.entry}": did you mean "${typo.suggestion}"? `, button('Fix', b => fix(typo.entry, typo.suggestion, b)), ' · ', button('Keep', () => keep(typo.entry)));
    return line;
  });
}

// Asks the main process once per set of lists (it caches by their contents too), then redraws. labelsOf(name) -> the list's labels.
export async function loadMeanings(labelsOf, redraw) {
  const lists = Object.fromEntries(MEANING_LISTS.map(name => [name, labelsOf(name)]));
  const asked = JSON.stringify(lists);
  if (strategyState.meaningsAsked === asked || !window.pilot?.listMeanings) return;
  strategyState.meaningsAsked = asked;
  const result = await window.pilot.listMeanings(lists).catch(() => null);
  if (!result || strategyState.meaningsAsked !== asked) return;
  strategyState.meanings = result.meanings || {};
  strategyState.keptTypos = result.kept || [];
  if (Object.keys(strategyState.meanings).length) redraw();
}
