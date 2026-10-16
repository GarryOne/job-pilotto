// The one-time hint after a cover letter, application kit or prep kit was written on Free AI: stronger writing comes with the person's own Claude or
// ChatGPT (owner, 16 Oct 2026). A quality message only: never a number, never "more applications". Shown once, dismissible, with a link to
// Settings → AI engine. Every place that shows such a result calls hintAfter(host); guard: test/own-key-hint.test.js.
import {el} from './components.js';
import {HINT, hintWanted} from './ai-engine-view.js';

// The hint as a node, or null (not Free, or already shown). Marks it shown at once, so it never comes back, even if the screen is closed unread.
export function ownKeyHint(state, {openSettings = () => {}, save = patch => window.pilot.saveSettings(patch)} = {}) {
  if (!state?.settings || !hintWanted(state.settings)) return null;
  state.settings.ownKeyHintSeen = true;
  Promise.resolve(save({ownKeyHintSeen: true})).catch(error => console.error('hint flag not saved', error));
  const row = el('p', 'muted small own-key-hint');
  const link = el('button', 'link', HINT.link), close = el('button', 'link', HINT.dismiss);
  link.type = close.type = 'button';
  link.addEventListener('click', () => { row.remove(); openSettings(); });
  close.addEventListener('click', () => row.remove());
  row.append(el('span', '', `${HINT.text} `), link, el('span', '', ' · '), close);
  return row;
}

// Puts the hint right after `anchor` (a message line under a finished letter or kit).
export function hintAfter(anchor, state, openSettings) {
  const node = anchor && ownKeyHint(state, {openSettings});
  if (node) anchor.after(node);
  return node;
}
