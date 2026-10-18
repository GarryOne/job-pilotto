// Profile → Experience's Education as entries (owner, 18 Oct 2026, decision 3): Degree / qualification · School · Years, with Add education and Remove
// entry. Only a line in the app's own shape ("Degree · School" or "Degree · School · Years") is read as fields; any other line is kept as written (an
// unstructured entry the person may organize into fields), never guessed apart and never put whole into Degree. A line in brackets is a note, kept as is.
// An entry left as it was keeps its line's own text, so opening and saving changes nothing. No DOM: guarded by test/education-model.test.js.
import {isNote, shownText} from './experience-profile-model.js';

export const FIELDS = ['degree', 'school', 'years'];
const SEP = /\s*·\s*/;

// A line's fields, or null when it is not in the app's shape (one part, or more than three).
export function fieldsOf(text) {
  const parts = shownText(text).split(SEP);
  if (parts.length < 2 || parts.length > 3) return null;
  const [degree = '', school = '', years = ''] = parts;
  return {degree, school, years};
}

// Fields → the line written to the Profile: the parts in order, trailing empty ones dropped but never below two (so it reads back as fields).
export function lineOf(fields) {
  const parts = FIELDS.map(key => String(fields?.[key] || '').replace(/\s*·\s*/g, ' ').trim());
  while (parts.length > 2 && !parts[parts.length - 1]) parts.pop();
  return parts.every(part => !part) ? '' : parts.join(' · ');
}

// part → entries [{index, text, fields | null}] (index: the line's place in part.lines; notes are not entries).
export const entriesOf = part => (part?.lines || []).flatMap((line, index) => (isNote(line.text) ? [] : [{index, text: line.text, fields: fieldsOf(line.text)}]));

const same = (a, b) => FIELDS.every(key => String(a?.[key] || '').trim() === String(b?.[key] || '').trim());

// The texts for changesFor(): one per line of the part in its order (a note as it is, a kept entry as it was unless its fields changed, a removed one
// empty), then the new entries. drafts: [{index (or null for a new one), text?, fields?, removed?}]. An unstructured entry organized into fields keeps its
// words when every field is left empty: nothing typed, nothing lost.
export function textsOf(part, drafts) {
  const lines = part?.lines || [];
  const byIndex = new Map(drafts.filter(draft => draft.index != null).map(draft => [draft.index, draft]));
  const texts = lines.map((line, index) => {
    const draft = byIndex.get(index);
    if (!draft) return line.text;
    if (draft.removed) return '';
    if (!draft.fields) return draft.text === undefined || draft.text.trim() === shownText(line.text) ? line.text : draft.text;
    const was = fieldsOf(line.text);
    if (was ? same(was, draft.fields) : !lineOf(draft.fields)) return line.text;
    return lineOf(draft.fields);
  });
  const added = drafts.filter(draft => draft.index == null && !draft.removed).map(draft => (draft.fields ? lineOf(draft.fields) : String(draft.text || '').trim())).filter(Boolean);
  return [...texts, ...added];
}
