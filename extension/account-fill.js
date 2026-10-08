// What the extension types into a sign-in or sign-up page and presses (owner, 8 Oct 2026): the one site password into its password boxes, then the
// control the AI named. Injected into the page by account-step.js (each export must stand alone: no imports, nothing from this file's scope). The
// person's details (email, names, country) are NOT here: the normal fill puts them in by the label meanings, in any language (fill-flow.js).
// Guard: worker/test/account-fill.test.js, the live run (npm run live).
export function fillAccountBoxes(password) {
  let filled = 0;
  for (const box of document.querySelectorAll('input[type=password]')) {
    if (box.disabled || box.readOnly || box.value || !box.getClientRects().length) continue;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(box, password);   // React/Vue see the change too
    box.dispatchEvent(new Event('input', {bubbles: true}));
    box.dispatchEvent(new Event('change', {bubbles: true}));
    box.setAttribute('data-jobpilotto-filled', '1');
    filled++;
  }
  return filled;
}

// Press the account form's own button, once, when the page is ready: a password box was filled by us, no required control is still empty (a
// consent box, a code, a name the person must give), and no bot check is on the page. Returns what it did, as a short reason code for the log.
export function pressAccountButton(named = '') {
  const box = document.querySelector('input[type=password][data-jobpilotto-filled]');
  if (!box) return 'not-filled';
  if (document.documentElement.hasAttribute('data-jobpilotto-account-pressed')) return 'already-pressed';
  if (document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], iframe[src*="challenge"], [data-sitekey], .g-recaptcha, .h-captcha, .cf-turnstile')) return 'bot-check';
  const scope = box.form || document;
  const visible = el => el.getClientRects().length && !el.disabled;
  const empty = [...scope.querySelectorAll('input, select, textarea')].filter(el => visible(el) && !['hidden', 'submit', 'button', 'image', 'reset'].includes(el.type)
    && (el.required || el.getAttribute('aria-required') === 'true')
    && (el.type === 'checkbox' || el.type === 'radio' ? !el.checked : !String(el.value || '').trim()));
  if (empty.length) return 'needs-you';
  // The button the AI named (its text, copied from the page's own list), else the form's one submit button.
  const text = el => String(el.innerText || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const wanted = String(named || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const buttons = wanted ? [...document.querySelectorAll('button, input[type=submit], input[type=button], [role=button], a')].filter(el => visible(el) && text(el) === wanted).slice(0, 1)
    : [...scope.querySelectorAll('button[type=submit], input[type=submit], button:not([type])')].filter(visible);
  const lone = buttons.length === 1 ? buttons[0] : null;
  if (!lone) return buttons.length ? 'several-buttons' : 'no-button';
  document.documentElement.setAttribute('data-jobpilotto-account-pressed', '1');
  lone.click();
  return 'pressed';
}

// The control the AI named as the way to create a new account (a link or button on a sign-in page), pressed once. Nothing is filled first.
export function pressRegister(named) {
  const wanted = String(named || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!wanted) return 'not-named';
  const text = el => String(el.innerText || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const found = [...document.querySelectorAll('a, button, input[type=submit], input[type=button], [role=button]')].filter(el => el.getClientRects().length && !el.disabled && text(el) === wanted);
  if (found.length !== 1) return found.length ? 'several' : 'not-found';
  found[0].click();
  return 'pressed';
}
