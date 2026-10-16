// Settings: every control that opens the store's own page (Notion) shown only on that store ([data-notion-only]), and every "Saved in …" said
// from where the data is ([data-store-saved], store-words.js). Guarded by test/profile-tabs.test.js.
import {show} from './core.js';
import {inNotion, storeName, syncStoreName} from '../store-words.js';

export function showStoreParts() {
  syncStoreName();
  const links = inNotion();
  document.querySelectorAll('[data-notion-only]').forEach(node => show(node, links));
  document.querySelectorAll('[data-store-saved]').forEach(node => { node.textContent = `Saved in ${storeName()}`; });
  return links;
}

// plain: the textarea only (the Profile form's "Edit as text"), no cards and no switch.
