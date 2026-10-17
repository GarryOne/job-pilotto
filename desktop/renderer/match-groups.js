// Strategy's match lists in two groups (design system, owner 17 Oct 2026: "no raw values in chips"): a word stored as "word" or
// \bword\b matches the whole word only, any other also inside longer words. Chips never show the quotes; the group says it. Also a
// Google Jobs place in words ("Zurich,Zurich,Switzerland · de" -> "Zurich, Switzerland · German"). Pure; guarded by test/match-groups.test.js.

// The two groups' names, for every match list (places, skills, skip words): "inside longer words" (tax finds syntax), or the whole word only.
export const GROUPS = [['anywhere', 'Also inside longer words'], ['whole', 'Whole word only']];

// fragment -> true when it matches the whole word only: the settings page's "word" or a pattern wrapped in \b … \b.
export const isWholeWord = fragment => /^".+"$/s.test(String(fragment ?? '').trim()) || /^\\b.+\\b$/s.test(String(fragment ?? '').trim());
// A word typed in the "Whole word only" group, as the window sends it (cleanEdits stores it as \bword\b).
export const asWholeWord = word => `"${String(word).trim().replace(/^"+|"+$/g, '')}"`;
// A word as shown on its chip: never the quotes.
export const shownWord = word => String(word ?? '').trim().replace(/^"(.*)"$/s, '$1');

// entries [{fragment, label, added?}] -> {anywhere: [...], whole: [...]}, in order. A word just added is grouped by how it was typed.
export function matchGroups(entries) {
  const out = {anywhere: [], whole: []};
  for (const entry of entries || []) out[isWholeWord(entry.added ? entry.label : entry.fragment) ? 'whole' : 'anywhere'].push(entry);
  return out;
}

// The labels as drawn (one per meaning, renderer/chip-meanings.js) in their groups -> [{title, labels}], a meaning where its main entry is.
// Only a list holding both kinds is split (the groups named); one kind is one unnamed group: nothing to tell apart.
export function shownGroups(entries, shown) {
  const whole = new Set((entries || []).filter(entry => isWholeWord(entry.fragment)).map(entry => entry.label));
  const isWhole = label => whole.has(typeof label === 'string' ? label : label.main);
  const parts = GROUPS.map(([key, title]) => ({title, labels: shown.filter(label => isWhole(label) === (key === 'whole'))}));
  return parts.every(part => part.labels.length) ? parts : [{title: '', labels: shown}];
}

const languageName = code => {
  try { return new Intl.DisplayNames(['en'], {type: 'language'}).of(code) || code; } catch { return code; }
};
// "Zurich,Zurich,Switzerland · de" -> "Zurich, Switzerland · German": a repeated part said once, the language code as its name.
export function placeLabel(text) {
  const [where = '', language = ''] = String(text ?? '').split(' · ').map(part => part.trim());
  const parts = where.split(',').map(part => part.trim()).filter(Boolean)
    .filter((part, at, all) => at === 0 || part.toLowerCase() !== all[at - 1].toLowerCase());
  const said = /^[a-z]{2,3}(-[a-z]{2})?$/i.test(language) ? languageName(language) : language;
  return [parts.join(', '), said].filter(Boolean).join(' · ');
}
