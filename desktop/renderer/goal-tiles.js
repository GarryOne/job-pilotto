// The setup goals as label/value rows (Target level, Work mode, Minimum salary, Languages you work in): the setup review and the Strategy page
// draw them alike (owner, 7 Oct 2026). A click on a value or its pencil edits it in place (Enter or click away saves, Esc cancels); a long value
// is clamped to two lines, with the whole text on hover and while editing. onSave(key, text) null: read-only.
import {el} from './components.js';
import {icon} from './icons.js';
import {goalNote} from './strategy-parts.js';

export const GOAL_TILES = [['seniority', 'user', 'Target level'], ['work_mode', 'building', 'Work mode'], ['minimum_salary', 'chart', 'Minimum salary'],
  ['languages', 'globe', 'Languages you work in']];

export function goalTiles(goals, onSave) {
  return GOAL_TILES.flatMap(([key, glyph, label]) => {
    const term = el('dt', '', icon(glyph));
    term.append(label);
    const box = el('dd', 'goal');
    box.dataset.goal = key;
    // "(estimate)" and "(level ❓)" said in words under the value, with the one action each needs (owner mockup, 7 Oct 2026: red ❓ marks).
    const {text: current, note} = goalNote(key, (goals || {})[key] || '');
    const value = el('span', 'goal-value', current || '—');
    value.title = current || 'Not set';
    box.append(value);
    if (!onSave) return [term, box];
    let noteLine = null;   // added after the pencil: the value and its pencil stay on one line
    if (note) {
      const line = el('p', 'goal-note', note === 'levels' ? 'Levels not set · ' : 'Estimated · ');
      const act = el('button', 'link', note === 'levels' ? 'Add levels' : 'Confirm');
      act.type = 'button';
      act.title = note === 'levels' ? 'Write each level, e.g. "French (C1)"' : 'Keep this amount as your minimum';
      act.addEventListener('click', () => (note === 'levels' ? value.click() : onSave(key, current, value)));
      line.append(act);
      noteLine = line;
    }
    value.classList.add('editable');
    value.title = `${current || 'Not set'}\n(click to correct)`;
    // A visible edit button, so it's clear the value can be corrected (clicking the value works too).
    const edit = el('button', 'icon-button goal-edit', icon('edit'));
    edit.type = 'button';
    edit.title = `Correct ${label.toLowerCase()}`;
    edit.setAttribute('aria-label', edit.title);
    edit.addEventListener('click', () => value.click());
    box.append(edit);
    if (noteLine) box.append(noteLine);
    value.addEventListener('click', () => {
      if (value.isContentEditable) return;
      value.contentEditable = 'plaintext-only';
      if (!current) value.textContent = '';
      value.focus();
      getSelection().selectAllChildren(value);
      let done = false;
      const finish = keep => {
        if (done) return;
        done = true;
        value.contentEditable = 'false';
        const text = value.textContent.trim();
        if (keep && text && text !== current) onSave(key, text, value);
        else value.textContent = current || '—';
      };
      value.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); finish(true); }
        if (event.key === 'Escape') { event.preventDefault(); finish(false); }
      });
      value.addEventListener('blur', () => finish(true), {once: true});
    });
    return [term, box];
  });
}
