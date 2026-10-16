// Settings → Profile → Preferences (the Profile text as a form): the rows of "Hard constraints", "Compensation" and "Preferences" as labelled inputs (a
// suggestion list fills an input, never limits it), a Notes box per section, and "Anything else" holding every other part of the page exactly as written.
// Two backends, one form: this Mac's text (saved whole through textSave, notes and the rest editable), and a store whose page is the editor (Notion:
// profileForm / profileFormSave change ONE cell or ONE bullet; notes and the rest are shown read-only with a link to the page). "Edit as text" is the
// plain editor. Model and writer: renderer/profile-model.js, lib/profile-outline.js; guarded by test/profile-model.test.js, profile-outline.test.js
// and test/profile-form.test.js.
import {el, pill} from '../components.js';
import {message} from './core.js';
import {openInNotion} from './notion-connect.js';
import {NOTION_PAGES, loadTextEditor} from './text-editors.js';
import {cardsEditor} from './text-cards.js';
import {storeName} from '../store-words.js';
import {SUGGESTIONS, needsAnswer, normalized, parseProfile, serializeProfile} from '../profile-model.js';

const LEADS = {constraints: 'Jobs that break these are filtered out before scoring.', pay: 'What a job must pay, to be worth your time.',
  preferences: 'Soft: used to rank jobs, never to remove them.'};
let uid = 0;

function field(label, value, onInput, {suggestions = [], wide = false} = {}) {
  const box = el('label', wide ? 'span-all' : '');
  const name = el('span', '', label);
  const input = Object.assign(el('input', ''), {type: 'text', value, placeholder: 'Not answered yet'});
  const flagNode = pill('Needs your answer', 'warn', {title: 'A ❓ in this value means it is still open'});
  const flag = () => { flagNode.hidden = !needsAnswer(input.value); };
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

function textBox(summary, text, {onInput = null, rows = 3, placeholder = ''} = {}) {
  const details = el('details', 'profile-notes');
  details.open = !!text;
  details.append(el('summary', onInput ? 'muted small' : 'muted small', summary));
  const area = Object.assign(el('textarea', ''), {rows, value: text, placeholder, spellcheck: true, readOnly: !onInput});
  if (onInput) area.addEventListener('input', () => onInput(area.value));
  details.append(area);
  return details;
}

function sectionView(section, change, {notesEditable}) {
  const box = el('div', 'profile-section');
  box.append(el('h4', '', section.heading), el('p', 'muted small', LEADS[section.kind] || ''));
  const grid = el('div', 'form-grid cols-2');
  for (const row of section.rows) {
    const suggestions = SUGGESTIONS[String(row[0]).toLowerCase()] || [];
    grid.append(field(row[0], row[1] ?? '', value => { row[1] = value; change(); }, {suggestions, wide: String(row[1] ?? '').length > 38}));
  }
  for (const bullet of section.bullets) grid.append(field(bullet.label, bullet.value, value => { bullet.value = value; change(); }, {wide: String(bullet.value).length > 38}));
  if (grid.children.length) box.append(grid);
  if (notesEditable || section.notes) box.append(textBox('Notes', section.notes, {onInput: notesEditable ? value => { section.notes = value; change(); } : null,
    placeholder: 'Anything the fields do not capture, in your own words.'}));
  return box;
}

// backend: {sections, rest, restEditable, dirty(), save() -> {ok, error?, again?}}; again = a fresh backend to show after a save.
function render(box, backend, {reload}) {
  const note = el('p', 'message');
  note.id = 'text-message-profile';
  const save = Object.assign(el('button', 'primary', 'Save changes'), {id: 'text-save-profile', type: 'button', disabled: true});
  const undo = Object.assign(el('button', 'secondary', 'Undo changes'), {type: 'button', disabled: true});
  const asText = Object.assign(el('button', 'link', 'Edit as text'), {type: 'button'});
  const follow = () => { save.disabled = undo.disabled = !backend.dirty(); };
  const restOpen = !!backend.rest;
  // The rest of the page as cards (a section per heading, a card per item: text-cards.js), read-only on Notion.
  const restCards = cardsEditor('profile', backend.rest, value => { backend.rest = value; follow(); }, {readOnly: !backend.restEditable});
  const rest = el('details', 'profile-notes');
  rest.append(el('summary', 'muted small', 'Anything else in your Profile'), restCards.node);
  rest.open = restOpen;
  rest.insertBefore(el('p', 'muted small', backend.restEditable ? 'Your summary, skills, experience and any other part of the page, kept exactly as written. The AI reads it with the rest.'
    : 'The rest of your Profile page: your summary, skills, experience and notes. It is edited on its page.'), rest.querySelector('textarea, .text-cards'));
  if (!backend.restEditable) {
    const edit = Object.assign(el('button', 'link', `Edit in ${storeName()}`), {type: 'button'});
    edit.addEventListener('click', event => openInNotion(NOTION_PAGES.profile, event));
    rest.append(edit);
  }
  const sections = backend.sections.map(section => sectionView(section, follow, {notesEditable: backend.restEditable}));
  const empty = backend.sections.length ? [] : [el('p', 'muted', 'No constraints or preferences yet: they appear here once your Profile has them. Meanwhile, everything is under "Anything else".')];
  undo.addEventListener('click', () => { message(note.id, ''); reload(); });
  asText.addEventListener('click', async () => {
    await loadTextEditor('profile', {plain: true});
    const back = Object.assign(el('button', 'link', 'Back to the form'), {type: 'button'});
    back.addEventListener('click', reload);
    box.append(back);
  });
  save.addEventListener('click', async () => {
    save.disabled = true;
    const answer = await backend.save().catch(error => ({ok: false, error: error.message}));
    if (answer.ok && answer.again) { render(box, answer.again, {reload}); message(note.id, 'Saved ✓ The next kits and form fills use it.', 'ok'); return; }
    follow();
    message(note.id, answer.ok ? 'Saved ✓ The next kits and form fills use it.' : answer.error, answer.ok ? 'ok' : 'error');
  });
  const buttons = el('div', 'inline');
  buttons.append(save, undo, asText);
  box.replaceChildren(...sections, ...empty, rest, note, buttons);
}

// This Mac: the whole text, saved whole.
function localBackend(markdown) {
  let saved = normalized(markdown);
  const model = parseProfile(markdown);
  return {sections: model.sections, restEditable: true, get rest() { return model.rest; }, set rest(value) { model.rest = value; },
    dirty: () => serializeProfile(model) !== saved,
    async save() {
      const text = serializeProfile(model);
      const answer = await window.pilot.textSave('profile', text);
      if (answer.ok) saved = normalized(text);
      return answer;
    }};
}

// Notion: the rows and bullets with their ids; only a value that changed is sent, as one cell or one bullet.
function notionBackend(data) {
  const sections = data.sections.map(section => ({...section, rows: section.rows.map(row => Object.assign([...row.cells], {id: row.id})), bullets: section.bullets.map(b => ({...b}))}));
  const was = new Map();
  for (const section of sections) { for (const row of section.rows) was.set(row.id, row[1] ?? ''); for (const bullet of section.bullets) was.set(bullet.id, bullet.value); }
  const changes = () => sections.flatMap(section => [...section.rows.map(row => ({id: row.id, kind: 'cell', value: row[1] ?? ''})),
    ...section.bullets.map(bullet => ({id: bullet.id, kind: 'bullet', value: bullet.value}))]).filter(change => change.value !== was.get(change.id));
  return {sections, rest: data.rest, restEditable: false, dirty: () => changes().length > 0,
    async save() {
      const answer = await window.pilot.profileFormSave(changes());
      return answer.ok ? {ok: true, again: notionBackend(answer)} : answer;
    }};
}

export async function loadProfileForm() {
  const panel = document.querySelector('[data-text-editor="profile"]');
  if (!panel) return;
  const box = panel.querySelector('.text-editor-body');
  box.replaceChildren(el('p', 'muted small', 'Loading…'));
  const result = await window.pilot.textGet('profile').catch(error => ({ok: false, error: error.message}));
  if (!result.ok) { box.replaceChildren(el('p', 'message error', `Couldn't read it: ${result.error}`)); return; }
  if (result.editable) return render(box, localBackend(result.markdown), {reload: loadProfileForm});
  const notion = await window.pilot.profileForm().catch(() => ({ok: false}));
  if (!notion.ok) return loadTextEditor('profile');
  render(box, notionBackend(notion), {reload: loadProfileForm});
}
