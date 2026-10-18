// The Profile's Possible CV gaps as a review list (owner review fix 6, mockup 06, 18 Oct 2026), in Profile → Experience: each skill to verify is a row with
// Confirm skill (the CV and the fill read it as a skill) and Dismiss (kept, so it is not asked again); reviewed ones fold under "Reviewed · N", each with Undo.
// The card's own words say what the list is; the Profile's other lines under the heading are shown as notes, apart from the decisions. No reason or source
// column: the store keeps only the skill and its state (owner, 18 Oct 2026: no invented evidence). Lines of the part are the model's (gaps-model.js).
// Guarded by test/gaps-rows.test.js.
import {el, pill} from './components.js';
import {icon} from './icons.js';
import {readLines} from './gaps-model.js';

const button = (label, className, aria, onClick) => {
  const node = Object.assign(el('button', className, label), {type: 'button'});
  node.setAttribute('aria-label', aria);
  node.addEventListener('click', event => { event.preventDefault(); onClick(); });
  return node;
};
export const pendingCount = part => readLines(part?.lines || []).items.filter(item => item.state === 'check').length;
const WORD = {skill: 'confirmed', dropped: 'dismissed'};

// part: {lines}; onPress(item, state): Confirm skill (skill), Dismiss (dropped) or Undo (check).
export function gapsBody(part, onPress, {tidied = null, onUndo = null} = {}) {
  const box = el('div', 'exp-part-body gap-rows'), read = readLines(part?.lines || []);
  if (!read.items.length && !read.other.length) { box.append(el('p', 'muted', 'Not set yet.')); return box; }
  const pending = read.items.filter(item => item.state === 'check'), reviewed = read.items.filter(item => item.state !== 'check');
  if (read.items.length) box.append(el('p', 'muted small', 'Skills to verify, not missing skills or gaps in your work history. Confirm only the ones you have used: tailored CVs and forms may then name them. Your CV file is not changed.'));
  if (pending.length) {
    const list = el('div', 'gap-list');
    list.append(...pending.map(item => {
      const row = el('div', 'gap-row');
      row.dataset.gap = item.item;
      const name = el('div', 'gap-name');
      name.append(el('b', '', item.item), pill('To check', 'warn'));
      row.append(name, button('Confirm skill', 'secondary small-btn', `${item.item}: confirm skill`, () => onPress(item, 'skill')),
        button('Dismiss', 'link', `${item.item}: dismiss`, () => onPress(item, 'dropped')));
      return row;
    }));
    box.append(list);
  } else if (read.items.length) box.append(el('p', 'muted small', 'All reviewed ✓'));
  if (reviewed.length) {
    const fold = el('details', 'gap-fold');
    const head = el('summary');
    head.append(icon('chevron', 'icon gap-chevron'), el('b', '', `Reviewed · ${reviewed.length}`), el('span', 'muted small', reviewed.map(item => `${item.item} ${WORD[item.state]}`).join(' · ')));
    const list = el('div', 'gap-list');
    list.append(...reviewed.map(item => {
      const row = el('div', 'gap-row');
      row.dataset.gap = item.item;
      const name = el('div', 'gap-name');
      name.append(el('b', '', item.item), pill(item.state === 'skill' ? 'Confirmed skill' : 'Dismissed', item.state === 'skill' ? 'good' : 'neutral'));
      row.append(name, button('Undo', 'link', `${item.item}: put back`, () => onPress(item, 'check')));
      return row;
    }));
    fold.append(head, list);
    box.append(fold);
  }
  if (read.other.length) {   // the Profile's own lines under this heading: shown as notes, never as a decision
    const notes = el('div', 'gap-notes');
    notes.append(el('span', 'muted small', 'Notes in your Profile'), ...read.other.map(other => el('p', 'muted small', other.text)));
    box.append(notes);
  }
  if (tidied && onUndo) {   // the one-time split of the paragraph: said once, with its Undo (the pages before it are backed up)
    const line = el('p', 'muted small', `Split from one paragraph into ${tidied.changed === 1 ? 'one list' : `${tidied.changed} lists`}. `);
    line.append(button('Undo', 'link', 'Put the CV gaps paragraph back', onUndo));
    box.append(line);
  }
  return box;
}
