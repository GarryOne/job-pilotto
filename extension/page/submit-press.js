// Does a click submit the form? One rule for the panel's "submit pressed" (review.js): a control that says so itself (type=submit or image, written on it),
// or one the Submit floor's words name. A <button> with no type attribute reports .type === "submit" in every browser, so the property says nothing: an answer
// button (a Yes/No choice, "Next") has it. A typeless button that really submits fires the form's own submit event, which review.js hears separately.
// A press the extension makes itself (a popup closer, a route press, a menu open) is marked by `press(el)` and is never the person's submit: `person(event)` says so for a click,
// and for the form's submit event the button that caused it (event.submitter) was one of those own presses, still in the same task. Structure and one floor of words, no site. Injected before review.js (background.js). Guarded by worker/test/submit-press.test.js.
(() => {
  if (window.__jobPilottoSubmitPress) return;
  const SUBMIT_WORDS = /\b(submit|send application)\b/i;
  const written = el => String(el.getAttribute?.('type') || '').trim().toLowerCase();
  const says = el => (el.tagName === 'BUTTON' && written(el) === 'submit') || (el.tagName === 'INPUT' && ['submit', 'image'].includes(written(el)));
  const own = new Set();   // the controls the EXTENSION clicked in this task (press, below): the submit event their default action fires comes right after, before the timeout
  const controlOf = target => target?.closest?.('button, input, a, [role=button]') || target;
  const release = (...els) => setTimeout(() => els.forEach(el => own.delete(el)), 0);
  // hold: how long the mark waits for the click to arrive (a debugger click crosses processes; a script's click is synchronous). A click that arrives consumes it, a tick later (the submit comes after the click).
  const mark = (el, hold = 0) => { if (!el) return; const control = controlOf(el); own.add(el); own.add(control); setTimeout(() => { own.delete(el); own.delete(control); }, hold); };
  const markAt = (x, y) => { const el = document.elementFromPoint(x, y); if (el) mark(el, 1500); return !!el; };
  // The extension's own presses all go through here (a popup closer, a route press, a menu open: `globalThis.__jobPilottoPress?.(el) || el.click()` at every site, guarded by worker/test/submit-press.test.js).
  // The site's scripts click too (a styled "Send" that clicks a hidden submit button): their click stays the person's.
  const press = el => { mark(el); el.click(); return true; };
  const person = event => event.type === 'submit' ? !(event.submitter ? own.has(event.submitter) : [...own].some(control => control.form && control.form === event.target)) : (own.has(controlOf(event.target)) ? (release(event.target, controlOf(event.target)), false) : true);
  window.__jobPilottoSubmitPress = {says, person, mark, markAt, press, counts: (el, words) => says(el) || SUBMIT_WORDS.test(words)};
  window.__jobPilottoPress = press;
})();
