// "Needs your attention": a question the employer can reject on by itself stands out in its row, whether it has a proposed answer, an
// empty box or Claude's own question (owner, 9 Oct 2026: suggest the answer anyway, but highlight the knockouts). The test is the one the
// "Before you submit" card uses (pages/session-form-card.js): the AI that read the form in any language (the form's report `knockouts`),
// or the shared pattern. Guarded by test/need-proposal.test.js.
import {el} from '../components.js';
import {KNOCKOUT} from '../knockout.js';
import {reviewStates} from './session-needs.js';

export const isKnockout = (item, label) => !!label && (KNOCKOUT.test(label) || (reviewStates.get(item.id)?.knockouts || []).includes(label));

// → the same row, marked: a warning edge and a bold line under the title. Styled in style.css (.ss-need.is-knockout).
export function markKnockout(li, item, label) {
  if (!isKnockout(item, label)) return li;
  li.classList.add('is-knockout');
  const body = li.querySelector('.ss-need-body');
  body?.insertBefore(el('b', 'ss-need-knock', 'Can reject you on its own: check this answer'), body.children[1] || null);
  return li;
}
