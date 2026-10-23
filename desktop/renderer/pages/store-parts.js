// Settings: every control that opens the store's own page (Notion) shown only on that store ([data-notion-only]), and every "Saved in …" said
// from where the data is ([data-store-saved], store-words.js). Guarded by test/profile-tabs.test.js.
import {show} from './core.js';
import {inNotion, storeName, syncStoreName} from '../store-words.js';

export function showStoreParts() {
  syncStoreName();
  const links = inNotion();
  document.querySelectorAll('[data-notion-only]').forEach(node => show(node, links));
  document.querySelectorAll('[data-store-saved]').forEach(node => { node.textContent = `Saved in ${storeName()}`; });
  // The setup sidebar's privacy note: its text names Notion only when it is the store; opened by the row, closed by x, Esc, click-away.
  const text = document.getElementById('privacy-text');
  if (text) text.textContent = `Passwords and keys are encrypted in the Keychain. While Always on is off, your data stays on this Mac${links ? ` and in your connected ${storeName()}` : ''}.`;
  bindPrivacyPop();
  return links;
}

// plain: the textarea only (the Profile form's "Edit as text"), no cards and no switch.

let privacyBound = false;
function bindPrivacyPop() {
  const toggle = document.getElementById('privacy-toggle'), pop = document.getElementById('privacy-pop');
  if (privacyBound || !toggle || !pop) return;
  privacyBound = true;
  const set = open => { pop.hidden = !open; toggle.setAttribute('aria-expanded', String(open)); };
  toggle.addEventListener('click', () => set(pop.hidden));
  document.getElementById('privacy-close').addEventListener('click', () => { set(false); toggle.focus(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !pop.hidden) set(false); });
  document.addEventListener('click', e => { if (!pop.hidden && !e.target.closest('.steps-privacy-wrap')) set(false); });
}
