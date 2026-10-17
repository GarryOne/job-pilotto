// One line of Your details' fact sections (owner, 17 Oct 2026: "Base facts fixed, AI the rest"): its label and the control of its kind (the mark on the line,
// else the kind judged for the label on this Mac; renderer/question-control.js), and what the Save bar reads back. A kind the code can't read the line in keeps
// the words as written with a "Check" chip: nothing is lost. Guarded by test/fact-line.test.js.
import {el, pill} from './components.js';
import {answerControl} from './question-control.js';
import {COMPOSITE, formatFor} from './question-kind.js';
import {keyOf} from './question-filter.js';
import {needsCheck} from './question-values.js';

const LONG = 60;   // characters: past this a text value wraps in a growing box

// key: the section; line: {label, value, kind}; formats: the kinds judged for labels ({[keyOf(label)]: {kind, options}}); onChange(): marks the page dirty.
export function factRow(key, {label = '', value = '', kind = '', note = ''} = {}, formats = {}, onChange = () => {}) {
  const row = el('label', 'fact-line');
  if (!label && !kind && key === 'languages') kind = 'language';   // a new line in Languages is a language: its name, then level chips
  const format = formatFor({marked: kind ? {kind} : null, kept: formats[keyOf(label)]});
  const composite = COMPOSITE.includes(format.kind);
  const name = Object.assign(document.createElement('input'), {type: 'text', value: label, placeholder: 'What (e.g. Notice period)'});
  name.dataset.factLabel = key;
  // A line read from the Profile keeps its words as its label; a new one is named by you.
  if (label) { name.hidden = true; row.append(el('span', '', label)); }
  name.addEventListener('input', onChange);
  // A long value in words is a box that grows, never cut by a one-line field.
  const long = format.control === 'text' && (String(value).length > LONG || String(value).includes('\n'));
  const control = answerControl(long ? {...format, control: 'textarea'} : format, value, onChange, {ariaLabel: label || 'Answer'});
  if (long) { control.rows = 1; row.classList.add('span-all'); }   // the whole row of the grid
  control.dataset.factValue = key;
  row.dataset.kind = composite ? format.kind : '';
  row.append(name, control);
  if (needsCheck(format.kind, value)) row.append(pill('Check', 'warn', {title: 'Saved as you wrote it; pick the parts to make it exact'}));
  // The words the value does not hold (a rule, a date it was confirmed) sit under it, never in it: folded as "Note for the AI" in a box that grows
  // (owner, 18 Oct 2026: "Folded Note for the AI"; the same fold as Profile → Application answers).
  if (note) {
    const fold = el('details', 'plain qa-note-fold'), remark = Object.assign(el('textarea', 'fact-note'), {value: note, rows: 1, ariaLabel: `${label || 'Answer'}: note for the AI`});
    remark.dataset.factNote = key;
    remark.addEventListener('input', onChange);
    fold.append(el('summary', 'muted small', 'Note for the AI'), remark);
    row.append(fold);
  }
  return row;
}

// -> {label, value, kind, note?}; kind only for a base-fact kind (the others ride on this Mac's judgment, never in the line).
export function factOf(row) {
  const note = row.querySelector('[data-fact-note]')?.value.trim();
  return {label: row.querySelector('[data-fact-label]').value.trim(), value: String(row.querySelector('[data-fact-value]').value ?? '').trim(), kind: row.dataset.kind || '', ...(note ? {note} : {})};
}
