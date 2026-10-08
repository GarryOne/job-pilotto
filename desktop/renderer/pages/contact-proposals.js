// "Your details from your CV" in the window: the values Claude proposed from the CV (lib/contact-from-cv.js) go into the empty boxes of
// Settings → Profile → Your details, each marked "From your CV", and the panel's Save is the confirmation. Nothing is saved before it.
// Also the nudge after Apply when the details forms usually ask for are missing. Guarded by test/contact-from-cv.test.js.
import {pill} from '../components.js';
import {$, message} from './core.js';
import {toastMessage} from './startup.js';

const MARK = 'proposal-pill';
const box = field => document.querySelector(`#setting-contact [data-contact="${field}"]`);

// Take the marks off (after Save, or before showing new proposals); an edited box keeps your value, unmarked.
export function clearProposals() {
  for (const input of document.querySelectorAll('#setting-contact [data-proposed]')) {
    delete input.dataset.proposed;
    input.parentElement.querySelector(`.${MARK}`)?.remove();
  }
}

// Fill each empty, visible box with its proposal. → how many were shown.
export function showProposals(proposals = []) {
  clearProposals();
  let shown = 0;
  for (const {field, value, sure} of proposals) {
    const input = box(field);
    if (!input || input.value.trim() || input.closest('[hidden]')) continue;
    input.value = value;
    input.dataset.proposed = 'cv';
    const mark = pill(sure ? 'From your CV' : 'From your CV · check it', sure ? 'info' : 'warn');
    mark.classList.add(MARK);
    input.after(mark);
    input.addEventListener('input', () => { delete input.dataset.proposed; mark.remove(); }, {once: true});
    shown++;
  }
  if (shown) {
    $('contact-save').disabled = false;
    message('contact-message', `${shown} detail${shown === 1 ? '' : 's'} filled in from your CV: check ${shown === 1 ? 'it' : 'them'}, then Save.`);
  }
  return shown;
}

// On opening the panel: what was proposed for this CV (Claude reads a CV once, so this is free after the first time).
// again: the "Fill from my CV" button, which reads the CV anew and says what it found.
export async function loadProposals({again = false} = {}) {
  const button = $('contact-from-cv');
  if (again) { button.disabled = true; message('contact-message', 'Reading your CV for missing details… (about 15 s)'); }
  const result = await window.pilot.contactProposals({again}).catch(error => ({proposals: [], error: error.message}));
  if (again) button.disabled = false;
  const shown = showProposals(result?.proposals || []);
  if (again && !shown) {
    message('contact-message', result?.error && result.error !== 'notion' ? `Couldn't read your CV: ${result.error === 'no AI' ? 'choose your AI in Settings → Connections first' : result.error}.`
      : 'Your CV has nothing for the empty boxes: type them once here.', result?.error ? 'error' : '');
  }
  return shown;
}

// After Apply: forms usually ask for these; when some are empty, say so once per app run, with what the CV can fill.
const USUAL = {phone: 'phone', street: 'street', postal_code: 'postal code', location: 'town'};
let nudged = false;
export async function nudgeMissingDetails() {
  if (nudged) return;
  const [contact, result] = await Promise.all([window.pilot.contact().catch(() => null), window.pilot.contactProposals({}).catch(() => null)]);
  if (!contact || !Object.keys(contact).length) return;   // not connected, or Notion unreadable: nothing to say
  const missing = Object.keys(USUAL).filter(key => !String(contact[key] || '').trim());
  if (!missing.length) return;
  nudged = true;
  const fromCv = (result?.proposals || []).filter(item => missing.includes(item.field)).length;
  toastMessage({title: 'Forms will ask for details you haven\'t given',
    body: `Missing: ${missing.map(key => USUAL[key]).join(', ')}.${fromCv ? ` ${fromCv} found in your CV: check and save them once.` : ' Add them once in your Profile.'}`,
    target: {view: 'settings', section: 'profile'}});
}
