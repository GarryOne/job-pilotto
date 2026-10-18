// The Profile's Voluntary surveys as one row per question with its fixed list and Decline (owner, 17 Oct 2026, decision B), the words besides the choice in a note under it
// and instructions for the AI in "Notes for the AI"; a line that is none of these stays as written. Drawn in Settings → Profile → Your details (pages/experience-profile.js);
// the lines are the model's (survey-model.js). Reads as label/value rows with the note muted under the value; edits as label | compact list | "+ note" (folded, open when
// it has text), one "Notes for the AI" fold, other lines as wrapped boxes that never cut a saved value. Guarded by test/survey-rows.test.js and test/survey-design.test.js.
import {el} from './components.js';
import {answerControl} from './question-control.js';
import {formatFor} from './question-kind.js';
import {SURVEYS, NOTES_LABEL, readLines, textsFor} from './survey-model.js';
import {longText} from './edit-controls.js';

// An answer to a question that is not on a list ("Label: value") shows as a row like the others; display only, the saved line stays as written. The label is up to the FIRST colon
// (a note may hold more); a long question stacks above its answer. A line with no short label stays a paragraph.
export function otherRow(text) {
  const at = String(text).indexOf(': ');
  return at > 0 && at <= 160 ? {label: text.slice(0, at).replace(/^["“]|["”]$/g, '').trim(), value: text.slice(at + 2).trim(), stacked: at > 40} : null;
}

// What the card shows: all the questions, each with its choice and its note small and muted under it ("Not set" when unanswered), then the other answers, then the notes for the AI folded last.
export function surveyBody(part, {sorting = false} = {}) {
  const box = el('div', 'exp-part-body'), read = readLines(part?.lines || []);
  if (sorting) box.append(el('p', 'muted small survey-sorting', 'Sorting your answers…'));
  const list = el('dl', 'summary-rows survey-answers');
  for (const each of SURVEYS) {
    const answer = read.answers.get(each.key), value = el('dd', '');
    if (answer) value.append(el('div', '', answer.option), ...(answer.note ? [el('div', 'muted small survey-note', answer.note)] : []));
    else value.append(el('div', 'muted small survey-unset', 'Not set'));
    list.append(el('dt', '', each.label), value);
  }
  box.append(list);
  const others = read.other.map(other => ({other, row: otherRow(other.text)}));
  if (others.some(each => each.row)) {
    const extra = el('dl', 'summary-rows survey-answers survey-other');
    for (const {row} of others) {
      if (!row) continue;
      const dt = el('dt', row.stacked ? 'survey-stacked' : '', row.label), dd = el('dd', row.stacked ? 'survey-stacked' : '', row.value);
      extra.append(dt, dd);
    }
    box.append(extra);
  }
  for (const {other, row} of others) if (!row) box.append(el('p', 'muted small', other.text));
  if (read.notes.length) {
    const fold = el('details', 'survey-notes-read');
    fold.append(el('summary', 'muted small', `${NOTES_LABEL} · ${read.notes.length} note${read.notes.length === 1 ? '' : 's'}`), ...read.notes.map(note => el('p', 'muted small', note.text)));
    box.append(fold);
  }
  return box;
}

// The editor: -> {node, texts()}; texts() = the part's lines as they should now be (textsFor), to turn into changes.
// onChange(): any answer, note or line edited (the page save bar counts the card's drafts).
export function surveyForm(part, {onChange = () => {}} = {}) {
  const lines = part?.lines || [], read = readLines(lines), node = el('div', 'exp-part-lines survey-rows');
  const choices = {};
  for (const each of SURVEYS) {
    const answer = read.answers.get(each.key), row = el('div', 'survey-row');
    choices[each.key] = {option: answer?.option || '', note: answer?.note || ''};
    const control = answerControl(formatFor({marked: {kind: 'single', options: each.options}}), choices[each.key].option, next => { choices[each.key].option = next; onChange(); }, {ariaLabel: each.label});
    const note = longText(choices[each.key].note, `${each.label}: note`, 'A note for the AI (optional)', next => { choices[each.key].note = next; onChange(); });
    note.className = 'fact-note';
    note.hidden = !choices[each.key].note;
    const more = Object.assign(el('button', 'link small', '+ note'), {type: 'button'});
    more.hidden = !note.hidden;
    more.addEventListener('click', () => { note.hidden = false; more.hidden = true; note.focus?.(); });
    row.append(el('b', '', each.label), control, more, note);
    node.append(row);
  }
  const fold = el('details', 'survey-notes'), notes = [...read.notes.map(each => each.text), ''].map(text => longText(text, NOTES_LABEL, `${NOTES_LABEL} (optional)`, onChange));
  fold.open = read.notes.length > 0;
  fold.append(el('summary', '', NOTES_LABEL), ...notes);
  const others = read.other.map(each => ({index: each.index, field: longText(each.text, 'Line', '', onChange)}));
  node.append(fold);
  if (others.length) node.append(el('div', 'muted small', 'Other answers (not on a list, kept as written)'), ...others.map(each => each.field));
  return {node, texts() {
    const texts = textsFor(lines, choices, notes.map(field => field.value));
    for (const each of others) texts[each.index] = each.field.value;
    return texts;
  }};
}
