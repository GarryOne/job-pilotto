// A crawl match pattern as the words a person reads (owner, 17 Oct 2026: "the person never sees a pattern"): \bz[uü]rich\b -> zürich, "zug" -> zug,
// st\.? ?gallen -> st gallen, a|b -> a, b. Structure only, never a list of words. Display and comparison only: the patterns themselves are kept as
// stored. One rule for every screen (Strategy chips, the setup review, "Which locations are right?", set-aside rows) and src/desktop_strategy.py
// _readable(). Guarded by test/fragment-words.test.js.

// The top-level alternatives of a pattern ("a|(b|c)" -> ["a", "(b|c)"]).
function alternatives(text) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '\\') { i++; continue; }
    if (char === '(' || char === '[') depth++;
    else if ((char === ')' || char === ']') && depth > 0) depth--;
    else if (char === '|' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  return [...parts, text.slice(start)];
}

const plain = part => part
  .replace(/^"(.*)"$/, '$1')                       // "zug": the settings page's whole-word form
  .replace(/\\b/g, '')
  .replace(/\(\?:/g, '(')
  .replace(/\([^()]*\)\?/g, '')                    // (an optional group)? -> left out: photograph(e|er)? -> photograph
  .replace(/\(([^()|]*)\|[^()]*\)/g, '$1')         // (a|b) -> a
  .replace(/\[[^\]]*?([^\]])\]/g, '$1')            // a letter choice: its last letter (z[uü]rich -> zürich)
  .replace(/\\(.)/g, '$1')                         // \. -> .
  .replace(/[?*+()^$|{}[\]"]/g, '')
  .replace(/(^|\s)\.(?=\s|$)/g, '$1')
  .replace(/\.$/, '')                              // a sentence's full stop: "…in switzerland\\." -> "…in switzerland"
  .replace(/\s+/g, ' ')
  .trim();

// A pattern that is one group as a whole (\b(?:zug|luzern)\b) is read as that group's alternatives.
function unwrap(text) {
  const inner = text.replace(/^\\b(.*)\\b$/, '$1');
  if (!inner.startsWith('(') || !inner.endsWith(')')) return text;
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '\\') { i++; continue; }
    if (inner[i] === '(') depth++;
    else if (inner[i] === ')' && --depth === 0 && i < inner.length - 1) return text;   // the first group closes before the end
  }
  return inner.slice(1, -1).replace(/^\?:/, '');
}

// pattern -> the place names (or words) it matches, in order, no repeats, never empty strings.
export function fragmentNames(fragment) {
  const text = unwrap(String(fragment ?? '').trim().replace(/^"(.*)"$/, '$1'));
  const names = alternatives(text).map(plain).filter(Boolean);
  return [...new Set(names)];
}

// pattern -> one line of words ("deutschland / germany").
export const fragmentWords = fragment => fragmentNames(fragment).join(' / ');

// Each word capitalised (accents too: "zürich" -> "Zürich"), known acronyms in capitals.
export const titleCase = text => String(text).replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_, gap, letter) => gap + letter.toUpperCase())
  .replace(/\b(Aws|Gcp|Sre|Eks|Ecs|Slo|Ci|Cd|Eu|Eea|Uk|Usa?)\b/g, w => w.toUpperCase());
