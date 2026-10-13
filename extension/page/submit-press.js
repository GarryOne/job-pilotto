// Does a click submit the form? One rule for the panel's "submit pressed" (review.js): a control that says so itself (type=submit or image, written on it),
// or one the Submit floor's words name. A <button> with no type attribute reports .type === "submit" in every browser, so the property says nothing: an answer
// button (a Yes/No choice, "Next") has it. A typeless button that really submits fires the form's own submit event, which review.js hears separately.
// A press the extension makes itself (a popup closer, a route press, a menu open) is a script's click, never trusted, and never the person's submit: `person(event)` says so for a click,
// and for the form's submit event the button that caused it (event.submitter) was one of those own clicks, still in the same task. Structure and one floor of words, no site. Injected before review.js (background.js). Guarded by worker/test/submit-press.test.js.
(() => {
  if (window.__jobPilottoSubmitPress) return;
  const SUBMIT_WORDS = /\b(submit|send application)\b/i;
  const written = el => String(el.getAttribute?.('type') || '').trim().toLowerCase();
  const says = el => (el.tagName === 'BUTTON' && written(el) === 'submit') || (el.tagName === 'INPUT' && ['submit', 'image'].includes(written(el)));
  const own = new Set();   // the controls a script clicked in this task: the submit event their default action fires comes right after, before the timeout
  const person = event => {
    if (event.type === 'submit') return !(event.submitter ? own.has(event.submitter) : [...own].some(control => control.form && control.form === event.target));
    if (event.isTrusted) return true;
    const control = event.target?.closest?.('button, input, a, [role=button]');
    if (control) { own.add(control); setTimeout(() => own.delete(control), 0); }
    return false;
  };
  window.__jobPilottoSubmitPress = {says, person, counts: (el, words) => says(el) || SUBMIT_WORDS.test(words)};
})();
