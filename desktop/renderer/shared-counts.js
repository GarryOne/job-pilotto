// One count, every place it shows (owner, 18 Oct 2026, UI redesign: "a banner, a filter chip and a tab badge for the same thing come from one function"):
// a page defines the count once (defineCount(name, compute)); every node marked data-count-of="<name>" (the tab's badge, the filter chip, the banner's
// words) is painted from it by paintCount(name), so they can never disagree. A node with data-count-one / data-count-many gets words ("3 details to
// check"), else the bare number; a node hides at 0 unless data-count-zero="show". Guarded by test/page-parts.test.js.
import {setCount} from './components.js';

const sources = new Map();
export const countWords = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const countOf = name => { const value = Number(sources.get(name)?.() || 0); return Number.isFinite(value) ? value : 0; };

export function defineCount(name, compute, root = globalThis.document) {
  sources.set(name, compute);
  return paintCount(name, root);
}

// Paints every node of this count; call it after what it counts changed. → the count.
export function paintCount(name, root = globalThis.document) {
  const n = countOf(name);
  for (const node of root?.querySelectorAll?.(`[data-count-of="${name}"]`) || []) {
    const {countOne: one, countMany: many, countZero: zero} = node.dataset;
    if (one) node.textContent = countWords(n, one, many); else setCount(node, n);
    node.hidden = n === 0 && zero !== 'show';
  }
  return n;
}
