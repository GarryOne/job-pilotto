// Settings → Profile: the Profile page's own sections as short previews with Edit (owner, 17 Oct 2026: "Show a short preview with Edit, rather than
// hiding it entirely or displaying a large textarea"). Experience: summary, strengths, education, role history and any section the app does not
// know; Your details: the voluntary survey answers. Read from the Profile's outline and saved block by block on every store (IPC textOutline /
// textEdit); the model is renderer/experience-profile-model.js. Guarded by test/experience-profile.test.js.
import {el} from '../components.js';
import {$, message} from './core.js';
import {changesFor, isEmpty, partsOn, previewOf, profileParts, unset} from '../experience-profile-model.js';

// Where each tab draws its parts: the box and its message line in index.html.
const BOXES = {experience: ['exp-profile', 'exp-profile-message'], details: ['details-profile', 'details-profile-message']};
const parts = {};

export async function loadExperienceProfile(tab = 'experience') {
  const [boxId, messageId] = BOXES[tab];
  if (!$(boxId)) return;
  const result = await window.pilot.textOutline('profile').catch(error => ({ok: false, error: error.message}));
  if (!result?.ok) { message(messageId, `Couldn't read your Profile: ${result?.error || 'try again'}`, 'error'); return; }
  parts[tab] = profileParts(result.items);
  draw(tab);
}

function draw(tab) {
  const list = partsOn(parts[tab], tab);
  // A panel with one part (Your details' Voluntary surveys) already says its name: the part shows only its preview and link.
  $(BOXES[tab][0]).replaceChildren(...list.map(each => preview(tab, list.length === 1 ? {...each, solo: true} : each)));
}

function preview(tab, each) {
  const {key, title, part} = each;
  const empty = isEmpty(part);
  const row = el('div', 'exp-part');
  row.dataset.part = key;
  const head = el('div', 'exp-part-head');
  const edit = Object.assign(el('button', 'link', empty ? 'Add' : 'Edit'), {type: 'button'});
  edit.setAttribute('aria-label', `${empty ? 'Add' : 'Edit'} ${title.toLowerCase()}`);
  head.append(...(each.solo ? [] : [el('b', '', title)]), edit);
  row.append(head, el('p', `exp-part-preview${empty ? ' muted' : ''}`, previewOf(part) || 'Not set yet.'));
  edit.addEventListener('click', () => row.replaceWith(editor(tab, each)));
  return row;
}

// One input per line (a paragraph or a bullet) and one per table cell; "+ Add a line"; Save writes only what changed.
function editor(tab, each) {
  const {key, title, part} = each;
  const box = el('div', 'exp-part is-editing');
  box.dataset.part = key;
  const lines = el('div', 'exp-part-lines');
  const line = text => {
    const input = Object.assign(el('input', ''), {type: 'text', value: text.replace(/\*\*/g, '')});   // one line each, never a textarea (owner, 16 Oct 2026)
    input.dataset.partLine = key;
    input.setAttribute('aria-label', title);
    return input;
  };
  const rows = (part?.rows || []).map(row => {
    const cells = el('div', 'exp-part-row');
    cells.append(...row.cells.map((cell, index) => Object.assign(el('input', ''), {type: 'text', value: unset(cell) ? '' : cell, ariaLabel: `${title} ${index + 1}`})));
    return cells;
  });
  lines.append(...rows, ...(part?.lines.length ? part.lines.map(each => line(each.text)) : rows.length ? [] : [line('')]));
  const add = Object.assign(el('button', 'link', '+ Add a line'), {type: 'button'});
  add.addEventListener('click', () => lines.append(line('')));
  const save = Object.assign(el('button', 'primary', 'Save'), {type: 'button'});
  const cancel = Object.assign(el('button', 'secondary', 'Cancel'), {type: 'button'});
  const actions = el('div', 'inline');
  actions.append(save, cancel, add);
  cancel.addEventListener('click', () => box.replaceWith(preview(tab, each)));
  save.addEventListener('click', async () => {
    // A line whose words did not change keeps its own text (its bold, its list mark): only an edited line is rewritten.
    const texts = [...lines.querySelectorAll('input[data-part-line]')].map((input, i) => {
      const was = part?.lines[i]?.text;
      return was !== undefined && input.value.trim() === was.replace(/\*\*/g, '').trim() ? was : input.value;
    });
    const cells = rows.map((row, i) => [...row.querySelectorAll('input')].map((input, index) => (input.value.trim() === '' && unset(part.rows[i].cells[index]) ? part.rows[i].cells[index] : input.value)));
    const changes = changesFor(key, part, texts, cells);
    if (!changes.length) { box.replaceWith(preview(tab, each)); return; }
    save.disabled = true;
    const result = await window.pilot.textEdit('profile', changes).catch(error => ({ok: false, error: error.message}));
    if (result.items) parts[tab] = profileParts(result.items);
    message(BOXES[tab][1], result.ok ? 'Saved ✓ The next tailored CVs, letters and scores use it.' : result.error, result.ok ? 'ok' : 'error');
    if (result.ok || result.items) draw(tab); else save.disabled = false;
  });
  box.append(...(each.solo ? [] : [el('b', '', title)]), lines, actions);
  return box;
}
