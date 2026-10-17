// Strategy chips' pure rules (no DOM, so tests import them): which lists the AI reads, one chip per meaning in a list, and a Google Jobs place
// read as a place. Drawn by pages/strategy-chips.js. Guarded by test/strategy-chips.test.js.

// The lists read by lib/list-meanings.js LISTS (the same names; test/strategy-chips.test.js keeps them equal).
export const MEANING_LISTS = ['places', 'country', 'rights', 'stack', 'titleSkip', 'skip', 'remoteSkip', 'finders'];

// A list's labels as shown: the entries of one meaning become one {main, others}, in the place of its first entry; the rest as they are.
export function meaningLabels(groups, labels) {
  if (!groups?.length) return labels;
  const of = new Map(groups.flatMap(group => [group.main, ...group.others].map(member => [member, group])));
  const out = [], seen = new Set();
  for (const label of labels) {
    const group = of.get(label);
    if (!group) out.push(label);
    else if (!seen.has(group)) { seen.add(group); out.push(group); }
  }
  return out;
}

// "Zurich,Zurich,Switzerland · de" -> "Zurich, Switzerland · German": the place's parts once each, the language by its name.
export function placeText(text) {
  const [where, language] = String(text).split(' · ').map(part => part.trim());
  const parts = where.split(',').map(part => part.trim()).filter(Boolean).filter((part, i, all) => part !== all[i - 1]);
  let named = language || '';
  try { if (language) named = new Intl.DisplayNames(['en'], {type: 'language'}).of(language) || language; } catch { /* an unknown code stays as written */ }
  return named ? `${parts.join(', ')} · ${named}` : parts.join(', ');
}

// A list's chips in two named groups when it holds both kinds (design system, 17 Oct 2026: "Tax" showed in quotes): a quoted entry (or \bword\b) in the
// settings matches a whole word only, the others also inside longer words ("tax" finds "syntax"). One kind only: one group, no name (nothing to tell apart).
// entries: [{fragment, label}] as stored; shown: the labels as drawn (meaningLabels), a meaning goes where its main entry is.
export const WHOLE_WORD = 'Whole word only', ANYWHERE = 'Also inside longer words';
export function matchGroups(entries, shown) {
  const whole = new Set(entries.filter(entry => /^".+"$|^\\b.+\\b$/.test(String(entry.fragment).trim())).map(entry => entry.label));
  const isWhole = label => whole.has(typeof label === 'string' ? label : label.main);
  const parts = [{title: ANYWHERE, labels: shown.filter(label => !isWhole(label))}, {title: WHOLE_WORD, labels: shown.filter(isWhole)}];
  return parts[0].labels.length && parts[1].labels.length ? parts : [{title: '', labels: shown}];
}
