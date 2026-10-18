// The Profile's Voluntary surveys as one row per question with its fixed list and Decline (owner, 17 Oct 2026, decision B), the words besides the choice in a note under it
// and instructions for the AI in "Notes for the AI"; a line that is none of these stays as written. Drawn in Settings → Profile → Your details (pages/experience-profile.js);
// the lines are the model's (survey-model.js). Reads as label/value rows with the note muted under the value; edits as label | compact list | "+ note" (folded, open when
// it has text), one "Notes for the AI" fold, other lines as wrapped boxes that never cut a saved value. Guarded by test/survey-rows.test.js and test/survey-design.test.js.
import {el, pill} from './components.js';
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

// A value as its answer and its note: "4 (3 firms; the rest were contracts). (confirmed 25 Sep)" reads "4" with the rest muted under it. Only the shape decides (a short answer, then
// brackets or a sentence after it), never words; nothing is dropped: the note holds every other word, the saved line stays as written.
export function valueAndNote(text) {
  const value = String(text || '').trim(), cut = value.search(/\s\(|\.\s/);
  if (cut <= 0 || cut > 40) return {value, note: ''};
  return {value: value.slice(0, cut).trim(), note: unwrap(value.slice(cut).replace(/^\.?\s*/, ''))};
}
// A note's parts at the top level, brackets taken off and joined with " · ": "(3 firms). (confirmed 25 Sep)" -> "3 firms · confirmed 25 Sep". Unbalanced brackets stay as written.
function unwrap(text) {
  const parts = [];
  let depth = 0, from = 0, outside = '';
  for (let at = 0; at < text.length; at++) {
    if (text[at] === '(' && depth++ === 0) { outside += text.slice(from, at); from = at + 1; }
    else if (text[at] === ')' && depth > 0 && --depth === 0) { parts.push(outside, text.slice(from, at)); outside = ''; from = at + 1; }
  }
  if (depth !== 0) return text.trim();
  parts.push(outside + text.slice(from));
  return parts.map(part => part.trim().replace(/^[.;,]\s*/, '').replace(/[.;,]$/, '').trim()).filter(Boolean).join(' · ');
}
// A question asked as a whole sentence becomes a short label (its first words); the whole question stays one click away.
export const shortLabel = (label, max = 40) => (label.length <= max ? label : `${label.slice(0, label.lastIndexOf(' ', max) > 20 ? label.lastIndexOf(' ', max) : max).replace(/[\s,;:]+$/, '')}…`);

// The note under a value: muted and small; a long one folds after its first words, so a row stays one or two lines.
function noteNode(text) {
  if (text.length <= 120) return el('div', 'muted small survey-note', text);
  const fold = el('details', 'plain survey-note survey-note-fold');
  fold.append(el('summary', 'muted small', `${text.slice(0, text.lastIndexOf(' ', 90) > 40 ? text.lastIndexOf(' ', 90) : 90)}…`), el('div', 'muted small', text));
  return fold;
}
const valueCell = (value, note, extra = []) => { const cell = el('dd', ''); cell.append(el('div', '', value), ...extra, ...(note ? [noteNode(note)] : [])); return cell; };

// What the card shows: one lined list, one row per field (owner, 18 Oct 2026: "looks bad … make it more nice UI"). Every question first, with its choice and its note small and muted
// under it ("Not set" when unanswered). A line written before the question had a list ("Race / ethnicity: White (use …)") fills that question's row with its words and "Check",
// never a second row while the first says "Not set". Then the other answers in the same rhythm (a long question as a short label, the whole question folded), then the notes for the AI folded last.
export function surveyBody(part, {sorting = false} = {}) {
  const box = el('div', 'exp-part-body'), read = readLines(part?.lines || []);
  if (sorting) box.append(el('p', 'muted small survey-sorting', 'Sorting your answers…'));
  const list = el('dl', 'summary-rows is-lined survey-answers');
  const others = read.other.map(other => ({other, row: otherRow(other.text)}));
  const byLabel = new Map(SURVEYS.map(each => [each.label.toLowerCase(), each.key]));
  const prose = new Map();   // question key -> its line written as words (not yet a choice)
  for (const each of others) {
    const key = each.row && byLabel.get(each.row.label.toLowerCase());
    if (key && !read.answers.has(key) && !prose.has(key)) { prose.set(key, each.row.value); each.used = true; }
  }
  for (const each of SURVEYS) {
    const answer = read.answers.get(each.key), words = prose.get(each.key);
    list.append(el('dt', '', each.label));
    if (answer) list.append(valueCell(answer.option, answer.note));
    else if (words) {
      const {value, note} = valueAndNote(words), check = pill('Check', 'warn', {title: 'Written as words, not yet one of the choices: Edit to pick one.'});
      check.classList.add('survey-check');
      list.append(valueCell(value, note, [check]));
    } else { const cell = el('dd', ''); cell.append(el('div', 'muted small survey-unset', 'Not set')); list.append(cell); }
  }
  for (const {row, used} of others) {
    if (!row || used) continue;
    const label = shortLabel(row.label), {value, note} = valueAndNote(row.value), dt = el('dt', 'survey-other', label);
    if (label !== row.label) dt.title = row.label;
    const cell = valueCell(value, note);
    if (label !== row.label) { const whole = el('details', 'plain survey-question'); whole.append(el('summary', 'muted small', 'The whole question'), el('div', 'muted small', row.label)); cell.append(whole); }
    list.append(dt, cell);
  }
  box.append(list);
  for (const {other, row} of others) if (!row) box.append(el('p', 'muted small', other.text));
  if (read.notes.length) {
    const fold = el('details', 'survey-notes-read plain');
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
