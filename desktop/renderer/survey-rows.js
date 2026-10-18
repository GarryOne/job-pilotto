// The Profile's Voluntary surveys as one row per question with its fixed list and Decline (owner, 17 Oct 2026, decision B), the words besides the choice in a note under it
// and instructions for the AI in "Notes for the AI"; a line that is none of these stays as written. Drawn in Settings → Profile → Your details (pages/experience-profile.js);
// the lines are the model's (survey-model.js). Reads as label/value rows with the note muted under the value; edits as label | compact list | "+ note" (folded, open when
// it has text), one "Notes for the AI" fold, other lines as wrapped boxes that never cut a saved value. Guarded by test/survey-rows.test.js and test/survey-design.test.js.
import {el} from './components.js';
import {answerControl} from './question-control.js';
import {formatFor} from './question-kind.js';
import {SURVEYS, NOTES_LABEL, readLines, textsFor} from './survey-model.js';

const LONG = {kind: 'long_text', control: 'textarea', options: []};
// A box that holds all of its text: as many rows as it wraps to (about 80 characters a row).
const longText = (value, label, placeholder, onInput = () => {}) => {
  const box = answerControl(LONG, value, next => { box.rows = Math.max(2, Math.ceil(String(next).length / 80)); onInput(next); }, {ariaLabel: label, placeholder});
  box.rows = Math.max(2, Math.ceil(String(value).length / 80));
  return box;
};

// An answer to a question that is not on a list ("Label: value") shows as a row like the others; display only, the saved line stays as written. A line with no short label stays a paragraph.
export function otherRow(text) {
  const at = String(text).lastIndexOf(': ');
  return at > 0 && at <= 160 ? {label: text.slice(0, at).replace(/^["“]|["”]$/g, '').trim(), value: text.slice(at + 2).trim()} : null;
}

// What the card shows: each answered question with its choice, its note muted under it, then the notes and the other lines.
export function surveyBody(part, {sorting = false} = {}) {
  const box = el('div', 'exp-part-body'), read = readLines(part?.lines || []);
  if (sorting) box.append(el('p', 'muted small survey-sorting', 'Sorting your answers…'));
  const rows = SURVEYS.filter(each => read.answers.has(each.key));
  if (!rows.length && !read.notes.length && !read.other.length) { box.append(el('p', 'muted', 'Not set yet.')); return box; }
  if (rows.length) {
    const list = el('dl', 'summary-rows');
    for (const each of rows) {
      const answer = read.answers.get(each.key), value = el('dd', '');
      value.append(el('div', '', answer.option), ...(answer.note ? [el('div', 'muted small', answer.note)] : []));
      list.append(el('dt', '', each.label), value);
    }
    box.append(list);
  }
  for (const note of read.notes) box.append(el('p', 'muted small', `${NOTES_LABEL}: ${note.text}`));
  const rowsOf = read.other.map(other => ({other, row: otherRow(other.text)}));
  if (rowsOf.some(each => each.row)) {
    const list = el('dl', 'summary-rows');
    for (const {row} of rowsOf) if (row) list.append(el('dt', '', row.label), el('dd', '', row.value));
    box.append(list);
  }
  for (const {other, row} of rowsOf) if (!row) box.append(el('p', 'muted small', other.text));
  return box;
}

// The editor: -> {node, texts()}; texts() = the part's lines as they should now be (textsFor), to turn into changes.
export function surveyForm(part) {
  const lines = part?.lines || [], read = readLines(lines), node = el('div', 'exp-part-lines survey-rows');
  const choices = {};
  for (const each of SURVEYS) {
    const answer = read.answers.get(each.key), row = el('div', 'survey-row');
    choices[each.key] = {option: answer?.option || '', note: answer?.note || ''};
    const control = answerControl(formatFor({marked: {kind: 'single', options: each.options}}), choices[each.key].option, next => { choices[each.key].option = next; }, {ariaLabel: each.label});
    const note = longText(choices[each.key].note, `${each.label}: note`, 'A note for the AI (optional)', next => { choices[each.key].note = next; });
    note.className = 'fact-note';
    note.hidden = !choices[each.key].note;
    const more = Object.assign(el('button', 'link small', '+ note'), {type: 'button'});
    more.hidden = !note.hidden;
    more.addEventListener('click', () => { note.hidden = false; more.hidden = true; note.focus?.(); });
    row.append(el('b', '', each.label), control, more, note);
    node.append(row);
  }
  const fold = el('details', 'survey-notes'), notes = [...read.notes.map(each => each.text), ''].map(text => longText(text, NOTES_LABEL, `${NOTES_LABEL} (optional)`));
  fold.open = read.notes.length > 0;
  fold.append(el('summary', '', NOTES_LABEL), ...notes);
  const others = read.other.map(each => ({index: each.index, field: longText(each.text, 'Line', '')}));
  node.append(fold);
  if (others.length) node.append(el('div', 'muted small', 'Other answers (not on a list, kept as written)'), ...others.map(each => each.field));
  return {node, texts() {
    const texts = textsFor(lines, choices, notes.map(field => field.value));
    for (const each of others) texts[each.index] = each.field.value;
    return texts;
  }};
}
