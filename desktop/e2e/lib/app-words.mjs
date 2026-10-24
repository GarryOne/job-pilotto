// Words a suite copies from the app: quoted prose in a suite that the app's own files say word for word. Each copy is a test that fails in the next beta when the app's wording changes
// (beta runs 5-11, 21-24 Oct 2026: 8 of ~10 e2e fixes). test/app-words-ratchet.test.mjs lets the count per suite only fall; the way out of a copy is a role, a test id, a pattern that
// reads the app's own name (withRoles, the SECTIONS heading pattern), or a constant the app exports.
const PROSE = /^[A-Z][A-Za-z0-9'’ .,!?…-]*[a-z.!?…]$/;

export function copiedWords(suiteText, appText) {
  const found = new Set();
  for (const [, , text] of String(suiteText).matchAll(/(["'`])((?:\\.|(?!\1).){10,80})\1/g)) {
    if (PROSE.test(text) && /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(text) && appText.includes(text)) found.add(text);
  }
  return [...found];
}
