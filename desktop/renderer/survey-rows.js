// The Profile's Voluntary surveys as one row per question with its fixed list and Decline (owner, 17 Oct 2026, decision B), the words besides the choice in a note under it
// and instructions for the AI in "Notes for the AI"; a line that is none of these stays as written. Drawn in Settings → Profile → Your details (pages/experience-profile.js);
// the lines are the model's (survey-model.js). Reuses answerControl and the fact line's note field. Guarded by test/survey-rows.test.js.
import {el} from './components.js';
import {answerControl} from './question-control.js';
import {formatFor} from './question-kind.js';
import {SURVEYS, NOTES_LABEL, readLines, textsFor} from './survey-model.js';

const input = (value, label, placeholder = '') => Object.assign(el('input', ''), {type: 'text', value, ariaLabel: label, placeholder});

// What the card shows: each answered question with its choice, its note small, then the notes and the other lines.
export function surveyBody(part) {
  const box = el('div', 'exp-part-body'), read = readLines(part?.lines || []);
  const rows = SURVEYS.filter(each => read.answers.has(each.key));
  if (!rows.length && !read.notes.length && !read.other.length) { box.append(el('p', 'muted', 'Not set yet.')); return box; }
  for (const each of rows) {
    const answer = read.answers.get(each.key), row = el('div', 'exp-part-group');
    const value = el('div', '');
    value.append(el('span', '', answer.option), ...(answer.note ? [el('span', 'muted small', ` · ${answer.note}`)] : []));
    row.append(el('b', '', each.label), value);
    box.append(row);
  }
  for (const note of read.notes) box.append(el('p', 'muted small', `${NOTES_LABEL}: ${note.text}`));
  for (const other of read.other) box.append(el('p', '', other.text));
  return box;
}

// The editor: -> {node, texts()}; texts() = the part's lines as they should now be (textsFor), to turn into changes.
export function surveyForm(part) {
  const lines = part?.lines || [], read = readLines(lines), node = el('div', 'exp-part-lines survey-rows');
  const choices = {}, noteInputs = {};
  for (const each of SURVEYS) {
    const answer = read.answers.get(each.key), row = el('div', 'fact-line');
    choices[each.key] = {option: answer?.option || '', note: answer?.note || ''};
    noteInputs[each.key] = Object.assign(input(choices[each.key].note, `${each.label}: note`, 'A note for the AI (optional)'), {className: 'fact-note'});
    noteInputs[each.key].addEventListener('input', () => { choices[each.key].note = noteInputs[each.key].value; });
    const control = answerControl(formatFor({marked: {kind: 'single', options: each.options}}), choices[each.key].option, next => { choices[each.key].option = next; }, {ariaLabel: each.label});
    row.append(el('b', '', each.label), control, noteInputs[each.key]);
    node.append(row);
  }
  const notes = [...read.notes.map(each => each.text), ''].map(text => input(text, NOTES_LABEL, `${NOTES_LABEL} (optional)`));
  const others = read.other.map(each => ({index: each.index, field: input(each.text, 'Line')}));
  node.append(...notes, ...others.map(each => each.field));
  return {node, texts() {
    const texts = textsFor(lines, choices, notes.map(field => field.value));
    for (const each of others) texts[each.index] = each.field.value;
    return texts;
  }};
}
