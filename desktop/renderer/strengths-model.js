// Profile → Experience's Strengths in the editor (owner, 18 Oct 2026, mockup 09): a group per "Label: a, b, c" line, its values as chips with × and
// "Add, then Enter"; a line with no label stays one plain line. A group left as it was keeps its line's own text (bold, list mark, separators), so
// opening and saving changes nothing; an edited one is written "**Label:** a, b, c" (plain "Label:" when its line had no bold). No DOM: guarded by
// test/strengths-model.test.js; the groups are experience-profile-model.js groupsOf().
import {groupsOf, shownText, splitItems} from './experience-profile-model.js';

// part → drafts [{index, label, items, plain}] (plain: a line with no label, edited as its words).
export const draftsOf = part => groupsOf(part).map((group, index) => (group.label ? {index, label: group.label, items: [...group.items]} : {index, label: '', items: [], plain: group.items[0]}));

// What the person typed in "Add, then Enter": one value, or several when they typed a list.
export const typedItems = text => splitItems(text);

export function lineOfGroup({label = '', items = [], plain}, was = '') {
  if (plain !== undefined) return String(plain).trim();
  const values = items.map(item => String(item).trim()).filter(Boolean);
  const name = String(label).replace(/:\s*$/, '').trim();
  if (!values.length) return '';   // every value removed: the group goes
  if (!name) return values.join(', ');
  return /\*\*/.test(was) || !was ? `**${name}:** ${values.join(', ')}` : `${name}: ${values.join(', ')}`;
}

// The texts for changesFor(): one per line in order (unchanged → its own text, emptied → ''), then new groups.
export function textsOf(part, drafts) {
  const lines = part?.lines || [], groups = groupsOf(part);
  const byIndex = new Map(drafts.filter(draft => draft.index != null).map(draft => [draft.index, draft]));
  const texts = lines.map((line, index) => {
    const draft = byIndex.get(index), was = groups[index];
    if (!draft) return line.text;
    if (draft.removed) return '';
    if (draft.plain !== undefined) return draft.plain.trim() === shownText(line.text) ? line.text : draft.plain;
    const same = was.label === draft.label.trim() && was.items.length === draft.items.length && was.items.every((item, i) => item === draft.items[i]);
    return same ? line.text : lineOfGroup(draft, line.text);
  });
  return [...texts, ...drafts.filter(draft => draft.index == null && !draft.removed).map(draft => lineOfGroup(draft)).filter(Boolean)];
}
