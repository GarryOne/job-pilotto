// Settings → Profile → Experience: "Professional summary" and "Strengths" at the top (owner, 17 Oct 2026: a short preview with Edit, never hidden
// and never a large textarea). Read from the Profile page's outline and saved block by block on every store (IPC textOutline / textEdit); the
// model is renderer/experience-profile-model.js. Guarded by test/experience-profile.test.js.
import {el} from '../components.js';
import {$, message} from './core.js';
import {PARTS, changesFor, previewOf, readParts} from '../experience-profile-model.js';

let parts = {};

export async function loadExperienceProfile() {
  const box = $('exp-profile');
  if (!box) return;
  const result = await window.pilot.textOutline('profile').catch(error => ({ok: false, error: error.message}));
  if (!result?.ok) { message('exp-profile-message', `Couldn't read your Profile: ${result?.error || 'try again'}`, 'error'); return; }
  parts = readParts(result.items);
  draw();
}

function draw() {
  $('exp-profile').replaceChildren(...Object.keys(PARTS).map(preview));
}

function preview(key) {
  const part = parts[key];
  const row = el('div', 'exp-part');
  row.dataset.part = key;
  const head = el('div', 'exp-part-head');
  const edit = Object.assign(el('button', 'link', part?.lines.length ? 'Edit' : 'Add'), {type: 'button'});
  edit.setAttribute('aria-label', `${part?.lines.length ? 'Edit' : 'Add'} ${PARTS[key].title.toLowerCase()}`);
  head.append(el('b', '', PARTS[key].title), edit);
  row.append(head, el('p', `exp-part-preview${part?.lines.length ? '' : ' muted'}`, previewOf(part) || 'Not set yet: tailoring uses your CV alone.'));
  edit.addEventListener('click', () => row.replaceWith(editor(key)));
  return row;
}

// One box per line (a paragraph or a bullet), sized to its text; "+ Add a line"; Save writes only what changed.
function editor(key) {
  const part = parts[key];
  const box = el('div', 'exp-part is-editing');
  box.dataset.part = key;
  const lines = el('div', 'exp-part-lines');
  const line = text => {
    const input = Object.assign(document.createElement('textarea'), {value: text.replace(/\*\*/g, ''), rows: Math.max(1, Math.ceil(text.length / 90))});
    input.dataset.partLine = key;
    input.setAttribute('aria-label', PARTS[key].title);
    return input;
  };
  lines.append(...(part?.lines.length ? part.lines.map(each => line(each.text)) : [line('')]));
  const add = Object.assign(el('button', 'link', '+ Add a line'), {type: 'button'});
  add.addEventListener('click', () => lines.append(line('')));
  const save = Object.assign(el('button', 'primary', 'Save'), {type: 'button'});
  const cancel = Object.assign(el('button', 'secondary', 'Cancel'), {type: 'button'});
  const actions = el('div', 'inline');
  actions.append(save, cancel, add);
  cancel.addEventListener('click', () => box.replaceWith(preview(key)));
  save.addEventListener('click', async () => {
    // A line whose words did not change keeps its own text (its bold, its list mark): only an edited line is rewritten.
    const texts = [...lines.querySelectorAll('textarea')].map((input, i) => {
      const was = part?.lines[i]?.text;
      return was !== undefined && input.value.trim() === was.replace(/\*\*/g, '').trim() ? was : input.value;
    });
    const changes = changesFor(key, part, texts);
    if (!changes.length) { box.replaceWith(preview(key)); return; }
    save.disabled = true;
    const result = await window.pilot.textEdit('profile', changes).catch(error => ({ok: false, error: error.message}));
    if (result.items) parts = readParts(result.items);
    message('exp-profile-message', result.ok ? 'Saved ✓ The next tailored CVs, letters and scores use it.' : result.error, result.ok ? 'ok' : 'error');
    if (result.ok || result.items) draw(); else save.disabled = false;
  });
  box.append(el('b', '', PARTS[key].title), lines, actions);
  return box;
}
