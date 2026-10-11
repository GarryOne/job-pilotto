// Does a click submit the form? One rule for the panel's "submit pressed" (review.js): a control that says so itself (type=submit or image, written on it),
// or one the Submit floor's words name. A <button> with no type attribute reports .type === "submit" in every browser, so the property says nothing: an answer
// button (a Yes/No choice, "Next") has it. A typeless button that really submits fires the form's own submit event, which review.js hears separately.
// Structure and one floor of words, no site. Injected before review.js (background.js). Guarded by worker/test/submit-press.test.js.
(() => {
  if (window.__jobPilottoSubmitPress) return;
  const SUBMIT_WORDS = /\b(submit|send application)\b/i;
  const written = el => String(el.getAttribute?.('type') || '').trim().toLowerCase();
  const says = el => (el.tagName === 'BUTTON' && written(el) === 'submit') || (el.tagName === 'INPUT' && ['submit', 'image'].includes(written(el)));
  window.__jobPilottoSubmitPress = {says, counts: (el, words) => says(el) || SUBMIT_WORDS.test(words)};
})();
