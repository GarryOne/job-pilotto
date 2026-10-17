// Employers → Add from a page (also ⌘K): a dialog where the person pastes a page's text or one address (an AI talent agent's matches, a newsletter,
// a VC portfolio); the scout pulls the company names out and checks them first (lib/employers-handlers.js fromPage → src/scout_paste.py).
// Built by script (index.html may only shrink). Guarded by test/employers-paste.test.js.
import {el} from '../components.js';
import {icon} from '../icons.js';
import {$, message} from './core.js';

export const PASTE_ID = 'emp-paste';

function dialog() {
  const box = el('dialog', 'save-dialog panel-dialog');
  box.id = 'emp-paste-dialog';
  const head = el('div', 'dialog-head'), tile = el('span', 'dialog-icon'), close = el('button', 'ghost icon-btn', '');
  tile.append(icon('building'));
  close.type = 'button'; close.setAttribute('aria-label', 'Close'); close.append(icon('close'));
  head.append(tile, el('h2', '', 'Add employers from a page'), close);
  const lead = el('p', 'dialog-lead', 'Paste a page that names companies: your matches from a talent agent, a newsletter, a startup list. '
    + 'Job Pilotto finds each one’s job board and checks it first.');
  const label = el('label', '', 'The page’s text, or its address'), field = el('textarea', '');
  label.htmlFor = 'emp-paste-text';
  Object.assign(field, {id: 'emp-paste-text', rows: 8, placeholder: 'Select all on the page, copy, and paste here. Or paste a public address (https://…).'});
  const note = el('p', 'muted small field-hint', 'A page behind a sign-in is never opened by the app: paste its text instead.');
  const msg = el('p', 'message', ''), cancel = el('button', 'ghost', 'Cancel'), go = el('button', 'primary', 'Find companies'), foot = el('div', 'dialog-foot');
  msg.id = 'emp-paste-message'; cancel.type = 'button'; go.type = 'button'; go.id = 'emp-paste-go';
  foot.append(cancel, go);
  box.append(head, lead, label, field, note, msg, foot);
  const shut = () => box.close();
  close.addEventListener('click', shut);
  cancel.addEventListener('click', shut);
  go.addEventListener('click', async () => {
    go.disabled = true;
    const result = await window.pilot.employersFromPage(field.value).catch(() => ({ok: false, error: 'That did not work. Try again in a moment.'}));
    go.disabled = false;
    if (!result?.ok) { message('emp-paste-message', result?.error || 'That did not work.', 'error'); return; }
    field.value = '';
    box.close();
    message('emp-message', 'Looking for these companies’ job boards. Follow it in Recent activity; new employers show here when it ends.', 'ok');
    $('emp-message').hidden = false;
  });
  return box;
}

export function openPaste() {
  const box = $('emp-paste-dialog') || document.body.appendChild(dialog());
  message('emp-paste-message', '');
  if (!box.open) box.showModal();
  $('emp-paste-text').focus();
}

// The page's button, next to Refresh; ⌘K finds it as a page button (pages/nav.js).
export function addPasteButton() {
  if ($(PASTE_ID)) return;
  const button = el('button', 'secondary with-icon', '');
  button.id = PASTE_ID; button.type = 'button'; button.title = 'Paste a page that names companies; their job boards are checked first';
  button.append(icon('building'), el('span', '', 'Add from a page'));
  button.addEventListener('click', openPaste);
  $('emp-refresh').before(button);
}
