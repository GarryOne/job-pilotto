// Voluntary surveys as fixed questions with fixed lists (owner, 17 Oct 2026, decision B: "Fixed lists + Decline"): each question has the choices below and always
// "Decline", never prose. An answer is one line of the Profile's survey part, "Gender identity: Man (note: or Male when that is the equivalent option)
// [pick one: Man | Woman | Non-binary | Decline]", the same text on every store; the words an answer carries besides its choice (a date it was confirmed, which
// option label to use) are its note, and instructions written for the AI are lines "Notes for the AI: …". A line that is none of these stays as written.
// The forms' own wording is mapped by the fill (worker FACT_RULE), so these choices are meanings, not a form's labels. Pure (no DOM): guarded by test/survey-model.test.js.
import {markOf} from './question-kind.js';

export const DECLINE = 'Decline to self-identify';
export const SURVEYS = [
  {key: 'age', label: 'Age bracket', options: ['Under 20', '20–29', '30–39', '40–49', '50–59', '60 or over']},
  {key: 'gender', label: 'Gender identity', options: ['Man', 'Woman', 'Non-binary']},
  {key: 'transgender', label: 'Identifies as transgender', options: ['Yes', 'No']},
  {key: 'orientation', label: 'Sexual orientation', options: ['Heterosexual / straight', 'Gay or lesbian', 'Bisexual', 'Another orientation']},
  {key: 'disability', label: 'Disability status', options: ['Yes', 'No']},
  {key: 'ethnicity', label: 'Race / ethnicity', options: ['White', 'Black or African American', 'Asian', 'Hispanic or Latino', 'Middle Eastern or North African', 'Native or Indigenous', 'Mixed or multiple', 'Another group']},
  {key: 'veteran', label: 'Veteran status', options: ['Yes', 'No']},
].map(each => ({...each, options: [...each.options, DECLINE]}));
export const NOTES_LABEL = 'Notes for the AI';
const NOTE = /^(.*?)\s*\(note: (.*)\)\s*$/s;
const bare = text => String(text || '').replace(/\*\*/g, '').replace(/^[-*•]\s*/, '').trim();
export const survey = key => SURVEYS.find(each => each.key === key) || null;

// The saved line of an answer: its label, choice, note and mark.
export function lineOf(key, option, note = '') {
  const found = survey(key);
  return `${found.label}: ${option}${String(note).trim() ? ` (note: ${String(note).trim()})` : ''} ${markOf({kind: 'single', options: found.options})}`.trim();
}
export const noteLine = text => `${NOTES_LABEL}: ${String(text).trim()}`;

// One line -> {type: 'answer', key, option, note} | {type: 'notes', text} | {type: 'other', text}. Only a line this app wrote matches: no word list.
export function readLine(text) {
  const plain = bare(text), at = plain.indexOf(':');
  if (at < 0) return {type: 'other', text: plain};
  const label = plain.slice(0, at).trim().toLowerCase(), rest = plain.slice(at + 1).replace(/\s*\[[^\]]*\]\s*$/, '').trim();
  if (label === NOTES_LABEL.toLowerCase()) return {type: 'notes', text: rest};
  const found = SURVEYS.find(each => each.label.toLowerCase() === label);
  if (!found) return {type: 'other', text: plain};
  const noted = rest.match(NOTE), option = (noted ? noted[1] : rest).trim();
  const chosen = found.options.find(each => each.toLowerCase() === option.toLowerCase());
  return chosen ? {type: 'answer', key: found.key, option: chosen, note: noted ? noted[2].trim() : ''} : {type: 'other', text: plain};
}

// The part's lines -> {answers: Map(key -> {option, note, index}), notes: [{text, index}], other: [{text, index}]}.
export function readLines(lines) {
  const out = {answers: new Map(), notes: [], other: []};
  (lines || []).forEach((line, index) => {
    const read = readLine(line.text ?? line);
    if (read.type === 'answer' && !out.answers.has(read.key)) out.answers.set(read.key, {option: read.option, note: read.note, index});
    else if (read.type === 'notes') out.notes.push({text: read.text, index});
    else out.other.push({text: read.type === 'other' ? read.text : bare(line.text ?? line), index});
  });
  return out;
}

// The texts that replace the part's lines after an edit: an existing line keeps its place (a cleared answer is '' and is removed), new answers go after.
// choices: {key: {option, note}} (option '' = none). Lines that are not an answer or a note (other) are kept as they were.
export function textsFor(lines, choices, notes) {
  const read = readLines(lines), texts = (lines || []).map(line => line.text ?? line), used = new Set();
  read.answers.forEach((answer, key) => {
    const next = choices[key];
    texts[answer.index] = next?.option ? lineOf(key, next.option, next.note) : '';
    used.add(key);
  });
  read.notes.forEach((note, i) => { texts[note.index] = notes[i] === undefined ? texts[note.index] : (String(notes[i]).trim() ? noteLine(notes[i]) : ''); });
  const added = [];
  for (const each of SURVEYS) if (!used.has(each.key) && choices[each.key]?.option) added.push(lineOf(each.key, choices[each.key].option, choices[each.key].note));
  for (const text of notes.slice(read.notes.length)) if (String(text).trim()) added.push(noteLine(text));
  return [...texts, ...added];
}
