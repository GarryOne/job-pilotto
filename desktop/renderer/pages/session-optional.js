// "Optional questions" on a session page (owner, 9 Oct 2026): the form's optional fields still empty, folded under "Needs your attention", with the
// same rows (its proposed answer and Use, else Open in form: session-needs.js emptyRow). They never count as actions remaining, the ring or
// "Ready to submit"; a consent is never listed (the panel leaves it out: extension/review.js `optional`). Guarded by test/session-optional.test.js.
import {$, show} from './core.js';
import {emptyRow, reviewStates} from './session-needs.js';
import {optionalLabels} from '../optional-questions.js';


export function showOptional(item, {gone = false, listed = []} = {}) {
  const labels = optionalLabels(reviewStates.get(item.id), {gone, listed});
  const card = $('ss-optional-card');
  show(card, labels.length > 0);
  $('ss-optional-count').textContent = labels.length ? `(${labels.length})` : '';
  const rows = labels.map(label => emptyRow(label, item));
  rows.forEach((li, i) => { const number = li.querySelector('.ss-need-num'); if (number) number.textContent = String(i + 1); });
  $('ss-optional').replaceChildren(...rows);
}

export function initOptional() {
  $('ss-optional-head').onclick = event => { if (!event.target.closest('a, button')) $('ss-optional-card').classList.toggle('is-open'); };
}
