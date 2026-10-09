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
const saved = {};
// Each panel's lead when its store's page is the editor (Notion): what it is, where it lives, and the link; index.html's lead (kept in
// dataset.editLead) when it is edited here. One sentence per text, so the three panels say the same thing the same way.
const READ_LEAD = {profile: 'Your Profile, as on its {store} page.', answers: 'The whole page of answers, as on its {store} page.',
  knowledge: 'What Job Pilotto remembered from your forms, as on its {store} page.'};   // name → the text as stored: Save and Revert follow what differs from it

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
  // Read-only: sized to its text (at most the editor's 16 rows), not an empty editor's height.
  const rows = result.editable ? 16 : Math.min(16, Math.max(3, String(result.markdown).split('\n').length + 1));
  const lead = panel.querySelector('.panel-lead');
  if (lead) lead.dataset.editLead ||= lead.textContent;
  if (lead && result.editable) lead.textContent = lead.dataset.editLead;
  const area = Object.assign(el('textarea', ''), {rows, value: result.markdown, readOnly: !result.editable, spellcheck: true,
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
    // Read-only here, said in the panel's own lead with its link (a link button, as "Open answers in Notion"): a read-only box looked like the
    // editor (mac-48's audit, 9 Oct 2026), and its button sat below the fold.
    const edit = Object.assign(el('button', 'link', `Edit in ${storeName()}`), {type: 'button'});
    edit.addEventListener('click', event => openInNotion(NOTION_PAGES[name], event));
    if (lead) { lead.textContent = `${READ_LEAD[name].replace('{store}', storeName())} `; lead.append(edit); }
    box.replaceChildren(area, note);
    return;
  }
  box.replaceChildren(area, note, buttons);
}
