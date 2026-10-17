// Strategy chips' meanings (no DOM, so tests import them): which lists the AI reads, and one chip per meaning in a list. Whole-word groups
// and place labels are renderer/match-groups.js. Drawn by pages/strategy-chips.js. Guarded by test/strategy-chips.test.js.

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
