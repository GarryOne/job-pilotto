// Settings → Profile → Profile text as a form: the rows of "Hard constraints", "Compensation" and "Preferences" as labelled inputs (a suggestion
// list fills an input, never limits it), a Notes box per section, and "Anything else" holding every other part of the page exactly as written.
// Saves the whole text through the same IPC as the plain editor (textGet / textSave); "Edit as text" is that editor. On a store whose page is
// the editor (Notion) the plain read-only view stays. Model and writer: renderer/profile-model.js; guarded by test/profile-model.test.js and
// test/profile-form.test.js.
import {el, pill} from '../components.js';
import {message} from './core.js';
import {loadTextEditor} from './text-editors.js';
import {SUGGESTIONS, needsAnswer, normalized, parseProfile, serializeProfile} from '../profile-model.js';

const LEADS = {constraints: 'Jobs that break these are filtered out before scoring.', pay: 'What a job must pay, to be worth your time.',
  preferences: 'Soft: used to rank jobs, never to remove them.'};
let uid = 0;

function field(label, value, onInput, {suggestions = [], wide = false} = {}) {
  const box = el('label', wide ? 'span-all' : '');
  const name = el('span', '', label);
  const input = Object.assign(el('input', ''), {type: 'text', value, placeholder: 'Not answered yet'});
  const flag = () => { flagNode.hidden = !needsAnswer(input.value); };
  const flagNode = pill('Needs your answer', 'warn', {title: 'A ❓ in this value means it is still open'});
  if (suggestions.length) {
    const list = Object.assign(el('datalist'), {id: `profile-suggest-${uid++}`});
    list.append(...suggestions.map(text => Object.assign(el('option'), {value: text})));
    input.setAttribute('list', list.id);
    box.append(list);
  }
  input.addEventListener('input', () => { onInput(input.value); flag(); });
  flag();
  name.append(' ', flagNode);
  box.prepend(name, input);
  return box;
}

function noteBox(text, onInput) {
  const details = el('details', 'profile-notes');
  details.open = !!text;
  details.append(el('summary', 'muted small', 'Notes'));
  const area = Object.assign(el('textarea', ''), {rows: 3, value: text, placeholder: 'Anything the fields do not capture, in your own words.', spellcheck: true});
  area.addEventListener('input', () => onInput(area.value));
  details.append(area);
  return details;
}

function sectionView(section, change) {
  const box = el('div', 'profile-section');
  box.append(el('h4', '', section.heading), el('p', 'muted small', LEADS[section.kind] || ''));
  const grid = el('div', 'form-grid cols-2');
  section.rows.forEach((row, i) => {
    const suggestions = SUGGESTIONS[String(row[0]).toLowerCase()] || [];
    grid.append(field(row[0], row[1] ?? '', value => { row[1] = value; change(); }, {suggestions, wide: String(row[1] ?? '').length > 38}));
  });
  section.bullets.forEach(bullet => grid.append(field(bullet.label, bullet.value, value => { bullet.value = value; change(); }, {wide: String(bullet.value).length > 38})));
  if (grid.children.length) box.append(grid);
  box.append(noteBox(section.notes, value => { section.notes = value; change(); }));
  return box;
}

export async function loadProfileForm() {
  const panel = document.querySelector('[data-text-editor="profile"]');
  if (!panel) return;
  const box = panel.querySelector('.text-editor-body');
  box.replaceChildren(el('p', 'muted small', 'Loading…'));
  const result = await window.pilot.textGet('profile').catch(error => ({ok: false, error: error.message}));
  if (!result.ok) { box.replaceChildren(el('p', 'message error', `Couldn't read it: ${result.error}`)); return; }
  if (!result.editable) return loadTextEditor('profile');
  let saved = normalized(result.markdown);
  const model = parseProfile(result.markdown);
  const note = el('p', 'message');
  note.id = 'text-message-profile';
  const save = Object.assign(el('button', 'primary', 'Save changes'), {id: 'text-save-profile', type: 'button', disabled: true});
  const undo = Object.assign(el('button', 'secondary', 'Undo changes'), {type: 'button', disabled: true});
  const asText = Object.assign(el('button', 'link', 'Edit as text'), {type: 'button'});
  const follow = () => { const changed = serializeProfile(model) !== saved; save.disabled = undo.disabled = !changed; };

  const rest = el('details', 'profile-notes');
  rest.open = !!model.rest;
  rest.append(el('summary', '', 'Anything else in your Profile'));
  rest.append(el('p', 'muted small', 'Your summary, skills, experience and any other part of the page, kept exactly as written. The AI reads it with the rest.'));
  const restArea = Object.assign(el('textarea', ''), {rows: 12, value: model.rest, spellcheck: true, placeholder: 'Nothing else yet.'});
  restArea.addEventListener('input', () => { model.rest = restArea.value; follow(); });
  rest.append(restArea);

  const sections = model.sections.map(section => sectionView(section, follow));
  const empty = model.sections.length ? [] : [el('p', 'muted', 'No constraints or preferences yet: they appear here once your Profile has them. Meanwhile, everything is under "Anything else".')];
  undo.addEventListener('click', () => { message(note.id, ''); loadProfileForm(); });
  asText.addEventListener('click', async () => {
    await loadTextEditor('profile');
    const back = Object.assign(el('button', 'link', 'Back to the form'), {type: 'button'});
    back.addEventListener('click', loadProfileForm);
    box.append(back);
  });
  save.addEventListener('click', async () => {
    save.disabled = true;
    const text = serializeProfile(model);
    const answer = await window.pilot.textSave('profile', text).catch(error => ({ok: false, error: error.message}));
    if (answer.ok) saved = normalized(text);
    follow();
    message(note.id, answer.ok ? 'Saved ✓ The next kits and form fills use it.' : answer.error, answer.ok ? 'ok' : 'error');
  });
  box.replaceChildren(...sections, ...empty, rest, note, el('div', 'inline', null));
  box.lastChild.append(save, undo, asText);
}
