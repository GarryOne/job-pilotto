// Settings → Profile: the whole Profile text, the standard answers and Form knowledge, read and edited in the app (IPC textGet/textSave,
// lib/text-handlers.js). One editor for the three ([data-text-editor] panels in index.html), the cover letter panel's parts (a textarea,
// .message, .inline buttons). On a store with pages to open (Notion) the text is shown read-only with "Edit in Notion": the page stays
// its editor there. Also hides what only Notion has ([data-notion-only]) and says where things are saved ([data-store-saved]) on the
// other stores. Guarded by test/text-editors.test.js.
import {el} from '../components.js';
import {message, show} from './core.js';
import {openInNotion} from './notion-connect.js';
import {inNotion, storeName, syncStoreName} from '../store-words.js';

export const NOTION_PAGES = {profile: 'NOTION_PROFILE_PAGE_ID', answers: 'NOTION_ANSWERS_PAGE_ID', knowledge: 'NOTION_KNOWLEDGE_PAGE'};
const saved = {};   // name → the text as stored: Save and Revert follow what differs from it

// Every control that opens the store's own page shown or hidden, and every "Saved in …" said, from where the data is (store-words.js).
export function showStoreParts() {
  syncStoreName();
  const links = inNotion();
  document.querySelectorAll('[data-notion-only]').forEach(node => show(node, links));
  document.querySelectorAll('[data-store-saved]').forEach(node => { node.textContent = `Saved in ${storeName()}`; });
  return links;
}

export async function loadTextEditor(name) {
  const panel = document.querySelector(`[data-text-editor="${name}"]`);
  if (!panel) return;
  const box = panel.querySelector('.text-editor-body');
  box.replaceChildren(el('p', 'muted small', 'Loading…'));
  const result = await window.pilot.textGet(name).catch(error => ({ok: false, error: error.message}));
  if (!result.ok) { box.replaceChildren(el('p', 'message error', `Couldn't read it: ${result.error}`)); return; }
  saved[name] = result.markdown;
  const area = Object.assign(el('textarea', ''), {rows: 16, value: result.markdown, readOnly: !result.editable, spellcheck: true,
    placeholder: result.editable ? 'Nothing here yet: type it, then Save.' : 'Nothing here yet.'});
  Object.assign(area.dataset, {textArea: name});
  const note = el('p', 'message');
  note.id = `text-message-${name}`;
  const buttons = el('div', 'inline');
  if (result.editable) {
    const save = Object.assign(el('button', 'primary', 'Save changes'), {id: `text-save-${name}`, type: 'button', disabled: true});
    const revert = Object.assign(el('button', 'secondary', 'Undo changes'), {type: 'button', disabled: true});
    const follow = () => { const changed = area.value !== saved[name]; save.disabled = !changed; revert.disabled = !changed; };
    area.addEventListener('input', follow);
    revert.addEventListener('click', () => { area.value = saved[name]; follow(); message(note.id, ''); });
    save.addEventListener('click', async () => {
      save.disabled = true;
      const answer = await window.pilot.textSave(name, area.value).catch(error => ({ok: false, error: error.message}));
      if (answer.ok) saved[name] = area.value;
      follow();
      message(note.id, answer.ok ? 'Saved ✓ The next kits and form fills use it.' : answer.error, answer.ok ? 'ok' : 'error');
    });
    buttons.append(save, revert);
  } else {
    const edit = Object.assign(el('button', 'secondary', `Edit in ${storeName()}`), {type: 'button'});
    edit.addEventListener('click', event => openInNotion(NOTION_PAGES[name], event));
    buttons.append(edit);
  }
  box.replaceChildren(area, note, buttons);
}
