// The Profile's Possible CV gaps as a review list (owner review fix 6, mockup 06, 18 Oct 2026), in Profile → Experience: each skill to verify is a row with
// Confirm skill (the CV and the fill read it as a skill) and Dismiss (kept, so it is not asked again); reviewed ones fold under "Reviewed · N", each with Undo:
// the shared review list (page-parts.js reviewList).
// The card's own words say what the list is; the Profile's other lines under the heading are shown as notes, apart from the decisions. No reason or source
// column: the store keeps only the skill and its state (owner, 18 Oct 2026: no invented evidence). Lines of the part are the model's (gaps-model.js).
// Guarded by test/gaps-rows.test.js.
import {el} from './components.js';
import {reviewList} from './page-parts.js';
import {readLines} from './gaps-model.js';

export const pendingCount = part => readLines(part?.lines || []).items.filter(item => item.state === 'check').length;
// Every skill decided: the card's header says "All reviewed" (no loose line under the list).
export const allReviewed = part => { const {items} = readLines(part?.lines || []); return items.length > 0 && items.every(item => item.state !== 'check'); };
const WORD = {'Confirmed skill': 'confirmed', Dismissed: 'dismissed'};
const STATUS = {check: {text: 'To check', tone: 'warn'}, skill: {text: 'Confirmed skill', tone: 'good'}, dropped: {text: 'Dismissed', tone: 'neutral'}};

// part: {lines}; onPress(item, state): Confirm skill (skill), Dismiss (dropped) or Undo (check).
export function gapsBody(part, onPress, {tidied = null, onUndo = null} = {}) {
  const box = el('div', 'exp-part-body gap-rows'), read = readLines(part?.lines || []);
  if (!read.items.length && !read.other.length) { box.append(el('p', 'muted', 'Not set yet.')); return box; }
  // One list in the live-card look (owner, 18 Oct 2026): the skills, then the Profile's other lines under this heading as Note rows (never a decision),
  // then the one-time split with its Undo; reviewed skills fold as the last row. No loose line above or below the list.
  const skills = read.items.map(item => ({key: item.item, title: item.item, status: STATUS[item.state], done: item.state !== 'check',
    actions: item.state === 'check'
      ? [{label: 'Confirm skill', aria: `${item.item}: confirm skill`, run: () => onPress(item, 'skill')}, {label: 'Dismiss', link: true, aria: `${item.item}: dismiss`, run: () => onPress(item, 'dropped')}]
      : [{label: 'Undo', link: true, aria: `${item.item}: put back`, run: () => onPress(item, 'check')}]}));
  const notes = read.other.map((other, i) => ({key: `note-${i}`, title: 'Note', why: other.text, note: true}));
  const split = tidied && onUndo ? [{key: 'split', title: `Split from one paragraph into ${tidied.changed === 1 ? 'one list' : `${tidied.changed} lists`}`,
    actions: [{label: 'Undo', link: true, aria: 'Put the CV gaps paragraph back', run: onUndo}]}] : [];
  if (read.items.length) box.append(el('p', 'muted small', 'Skills to verify. Confirm only the ones you have used; your CV file is not changed.'));
  box.append(reviewList([...skills, ...notes, ...split],
    {statusAt: 'title', rows: true, doneSummary: done => done.map(each => `${each.title} ${WORD[each.status.text]}`).join(' · ')}));
  return box;
}
