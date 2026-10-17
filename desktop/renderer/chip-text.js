// What a chip may show (design system, owner 17 Oct 2026: Strategy chips showed "Tax" in quotes and "Zurich,Zurich,Switzerland · de"): a value as a person
// writes it, never the store's syntax (quotes for a whole word, /a regex/, a comma list with no spaces). components.js chip() marks such text data-raw.
// Pure, guarded by test/chip.test.js.
const RAW = [
  /^(["'“‘]).+(["'”’])$/,        // "Tax": a match rule in quotes; show its meaning (a group "Whole word only")
  /^\/.+\/[a-z]*$/,               // /z[uü]rich/: a pattern
  /\\[bdwsWDS]|\[[^\]]+\]/,       // regex escapes or a character class inside the words
  /[^\s,],[^\s,]/,                // Zurich,Zurich,Switzerland: a stored list, not words
];
export const isRawValue = text => RAW.some(rule => rule.test(String(text ?? '').trim()));
