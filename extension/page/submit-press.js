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
  // The press floor (safety, 15 Oct 2026: a "Decline" of a Data Privacy Consent Statement opened "Delete All Data"): whatever named the control, the extension never presses one that deletes or removes an
  // account or data, withdraws an application or signs out, nor one that DECLINES inside a dialog that is no cookie or tracking notice. A refused press answers true (the callers' `|| el.click()` stays unused)
  // and is left in window.__jobPilottoRefused. Words are an extra floor ANDed with the AI's answer (desktop/lib/popup-pick.js `effect`), never the judge. Guard: worker/test/press-floor.test.js.
  const NEVER = /\b(delete|remove|erase|deactivate|withdraw|cancel|close)\b.{0,24}\b(account|data|profile|application)\b|\b(sign|log) ?out\b|\bdelete all\b|löschen|konto entfernen|supprimer|se déconnecter|eliminar cuenta|elimina (account|dati)|abmelden/i;
  const DECLINE = /^\W*(decline|reject|refuse|deny|disagree|i (do not|don't) (agree|accept|consent)|ablehnen|nicht zustimmen|refuser|rifiuta|rechazar)\b/i;
  const ABOUT_COOKIES = /cookie|tracking|traceurs/i;
  const textOf = el => String(el.innerText || el.textContent || el.value || el.getAttribute?.('aria-label') || el.getAttribute?.('title') || '').replace(/\s+/g, ' ').trim();
  const layerOf = el => { for (let node = el; node && node !== document.body && node !== document.documentElement; node = node.parentElement) { if (node.matches?.('[role=dialog], [role=alertdialog], [aria-modal=true], dialog')) return node; if (getComputedStyle(node).position === 'fixed') return node; } return null; };
  const refused = el => { const words = textOf(el); if (NEVER.test(words)) return true; if (!DECLINE.test(words)) return false; const layer = layerOf(el); return !!layer && !ABOUT_COOKIES.test(textOf(layer)); };
  const press = el => { if (refused(el)) { window.__jobPilottoRefused = textOf(el).slice(0, 60); return true; } mark(el); el.click(); return true; };
  const person = event => event.type === 'submit' ? !(event.submitter ? own.has(event.submitter) : [...own].some(control => control.form && control.form === event.target)) : (own.has(controlOf(event.target)) ? (release(event.target, controlOf(event.target)), false) : true);
  window.__jobPilottoSubmitPress = {refused, says, person, mark, markAt, press, counts: (el, words) => says(el) || SUBMIT_WORDS.test(words)};
  window.__jobPilottoPress = press;
})();
