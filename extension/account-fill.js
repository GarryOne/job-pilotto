// What the extension types into a sign-in or sign-up page and presses (owner, 8 Oct 2026): the one site password into its password boxes, then the
// control the AI named. Injected into the page by account-step.js (each export must stand alone: no imports, nothing from this file's scope). The
// person's details (email, names, country) are NOT here: the normal fill puts them in by the label meanings, in any language (fill-flow.js).
// Guard: worker/test/account-fill.test.js, the live run (npm run live).
export function fillAccountBoxes(password) {
  let filled = 0;
  for (const box of document.querySelectorAll('input[type=password]')) {
    if (box.value === password && box.getClientRects().length) box.setAttribute('data-jobpilotto-filled', '1');   // already the right password (the browser's own autofill): ours too, not counted as filled now
    if (box.disabled || box.readOnly || box.value || !box.getClientRects().length) continue;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(box, password);   // React/Vue see the change too
    box.dispatchEvent(new Event('input', {bubbles: true}));
    box.dispatchEvent(new Event('change', {bubbles: true}));
    box.setAttribute('data-jobpilotto-filled', '1');
    filled++;
  }
  return filled;
}

// Press the account form's own button, once (the caller asks the AI first: account-step.js): a password box we filled is on the page, no required control is empty
// (a second floor: the AI's "ready" is the first), no frame inside the form (a bot check, whoever makes it). Returns a short reason code for the log.
export function pressAccountButton(named = '') {
  const box = document.querySelector('input[type=password][data-jobpilotto-filled]');
  if (!box) return 'not-filled';
  if (document.documentElement.hasAttribute('data-jobpilotto-account-pressed')) return 'already-pressed';
  const scope = box.form || document;
  const visible = el => el.getClientRects().length && !el.disabled;
  if ([...scope.querySelectorAll('iframe')].some(visible)) return 'bot-check';
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

// What the AI is shown of the page (lib/account-judge.js): controls with their state but never their values, buttons and links, the short visible texts (messages,
// errors) and the host names of visible frames. Injected into the page.
export function accountSketch() {
  const shown = el => el.getClientRects().length > 0;
  const clean = (value, max) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const controls = [...document.querySelectorAll('input, select, textarea')].filter(el => shown(el) && !['hidden', 'submit', 'button', 'image', 'reset'].includes(el.type)).map(el => ({
    type: el.type, label: clean(el.labels?.[0]?.innerText || el.getAttribute('aria-label') || el.placeholder || el.name || '', 80),
    required: !!el.required || el.getAttribute('aria-required') === 'true',
    state: el.type === 'checkbox' || el.type === 'radio' ? (el.checked ? 'checked' : 'unchecked') : (String(el.value || '').trim() ? 'filled' : 'empty')}));
  const buttons = [...new Set([...document.querySelectorAll('button, input[type=submit], input[type=button], [role=button], a')].filter(shown).map(el => clean(el.innerText || el.value || el.getAttribute('aria-label'), 60)).filter(Boolean))];
  const seen = new Set(), texts = [];
  for (const el of document.body ? document.body.querySelectorAll('*') : []) {
    if (el.children.length || !shown(el) || ['SCRIPT', 'STYLE', 'OPTION', 'BUTTON', 'A', 'LABEL', 'INPUT'].includes(el.tagName)) continue;
    const text = clean(el.textContent, 160);
    if (text.length >= 3 && !seen.has(text)) { seen.add(text); texts.push(text); }
  }
  const frames = [...document.querySelectorAll('iframe')].filter(shown).map(el => { try { return new URL(el.src, location.href).hostname; } catch { return 'frame'; } });
  return {url: location.href.split('#')[0], title: clean(document.title, 160), headings: [...document.querySelectorAll('h1, h2, h3')].filter(shown).map(el => clean(el.innerText, 100)).slice(0, 8),
    controls, buttons: buttons.slice(0, 25), texts: texts.length > 30 ? [...texts.slice(0, 15), ...texts.slice(-15)] : texts, frames: frames.slice(0, 8)};
}

// Says on the page what the person must do (the panel reads it): the label of the control that needs them, "1" when only that the site did not accept it, null to clear it.
export function flagAccount(needs) { if (needs === null) document.documentElement.removeAttribute('data-jobpilotto-account-needs'); else document.documentElement.setAttribute('data-jobpilotto-account-needs', needs || '1'); }   // null: nothing is owed any more

// A control the AI named (the register link of a sign-in page, a consent link or accept button, a consent checkbox's label), pressed once. Nothing is filled first.
export function pressRegister(named) {
  const wanted = String(named || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!wanted) return 'not-named';
  const text = el => String(el.innerText || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const found = [...document.querySelectorAll('a, button, input[type=submit], input[type=button], [role=button], label')].filter(el => el.getClientRects().length && !el.disabled && text(el) === wanted);   // a label toggles its checkbox
  if (found.length !== 1) return found.length ? 'several' : 'not-found';
  found[0].click();
  return 'pressed';
}
