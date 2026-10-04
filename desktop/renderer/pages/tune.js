// Tune my strategy (Actions page): the changes your own results support (src/tune.py, no AI), each one ticked or not;
// only the ticked ones are written to ⚙️ Search settings (main.js tuneApply → lib/strategy.js retune).
import {el} from '../components.js';
import {$, message, show} from './core.js';
import {toastMessage} from './startup.js';

const VERB = {drop_role: 'Stop searching for', drop_place: 'Stop searching in', exclude_title: 'Skip job titles with'};

// One proposal as a ticked row: what changes, then the counts it rests on.
export function proposalRow(item) {
  const li = el('li', 'cvc-check');
  const label = el('label', 'tune-row');
  const box = el('input');
  box.type = 'checkbox';
  box.checked = true;
  box.value = item.id;
  const words = el('div');
  words.append(el('b', '', `${VERB[item.kind] || 'Change'} “${item.label}”`), el('span', 'muted small', item.why));
  label.append(box, words);
  li.append(label);
  return li;
}

// The line under the title: what the proposals were read from, or why there are none yet.
export function basisLine(answer) {
  const b = answer.basis || {};
  if (!b.jobs) return 'No results to learn from yet: save, dismiss or apply to some jobs first.';
  const read = `Read from ${b.jobs} job${b.jobs === 1 ? '' : 's'} you acted on: ${b.dismissed} dismissed, ${b.engaged} kept or applied, ${b.interviews} interview${b.interviews === 1 ? '' : 's'}.`;
  return answer.proposals?.length ? read : `${read} Nothing to change: no role, place or title word has ${b.min_dismissed}+ dismissals and none kept.`;
}

async function open() {
  $('tune-list').replaceChildren();
  show($('tune-apply'), false);
  message('tune-message', '');
  $('tune-basis').textContent = 'Reading your results…';
  if (!$('tune-dialog').open) $('tune-dialog').showModal();
  const answer = await window.pilot.tuneProposals();
  if (!answer?.ok) {
    $('tune-basis').textContent = '';
    message('tune-message', answer?.error || 'Could not read your results.', 'bad');
    return;
  }
  $('tune-basis').textContent = basisLine(answer);
  $('tune-list').replaceChildren(...answer.proposals.map(proposalRow));
  show($('tune-apply'), answer.proposals.length > 0);
}

async function apply() {
  const ids = [...$('tune-list').querySelectorAll('input:checked')].map(box => box.value);
  if (!ids.length) { message('tune-message', 'Tick at least one change, or close.', 'bad'); return; }
  $('tune-apply').disabled = true;
  message('tune-message', 'Saving to your search settings…', 'waiting');
  const result = await window.pilot.tuneApply(ids);
  $('tune-apply').disabled = false;
  if (!result?.ok) { message('tune-message', result?.error || 'Nothing changed. Try again.', 'bad'); return; }
  $('tune-dialog').close();
  toastMessage(`Strategy tuned: ${result.changed.length} change${result.changed.length === 1 ? '' : 's'}. The next search uses ${result.changed.length === 1 ? 'it' : 'them'}.`);
}

export function init() {
  $('tune-open').addEventListener('click', open);
  $('tune-close').addEventListener('click', () => $('tune-dialog').close());
  $('tune-apply').addEventListener('click', apply);
}
