// Where an email belongs, in your words: Focus → "Is this about …?" (an email the Gmail check wasn't sure about).
// One dialog: pick the job, a new job, or "not about a job"; src/ai/reassign.py attaches the email (Notion stays the
// one copy).
import {shared} from './shared.js';
import {$, message} from './core.js';
import {loadFocus, holdItem, releaseItem} from './focus.js';
import {loadJobs} from './jobs.js';
import {toastMessage} from './startup.js';
import {searchSelect} from '../search-select.js';

const option = (value, text) => Object.assign(document.createElement('option'), {value, textContent: text});
const labelOf = job => `${job.company || job.via || '—'} · ${job.title}${job.stage ? ` (${job.stage})` : ''}`;

function targets(current = '', suggested = '') {
  const tracked = shared.allJobs.filter(job => job.stage && !['Dismissed', 'Closed'].includes(job.stage) && job.url !== current)
    .sort((a, b) => labelOf(a).localeCompare(labelOf(b)));
  const group = Object.assign(document.createElement('optgroup'), {label: 'Your applications'});
  tracked.forEach(job => group.append(option(job.url, labelOf(job))));
  $('reassign-target').replaceChildren(option('new', 'Not in my list yet: a new job'), option('none', 'Not about a job'), ...(tracked.length ? [group] : []));
  $('reassign-target').value = suggested && tracked.some(job => job.url === suggested) ? suggested : 'new';
}

let pending = null;  // () => Promise<boolean>: what Save does in the dialog now open

function open({title, context, help}) {
  $('reassign-title').textContent = title;
  $('reassign-context').textContent = context || '';
  $('reassign-help').textContent = help;
  message('reassign-message', '');
  $('reassign-save').disabled = false;
  $('reassign-dialog').showModal();
}

export async function moveEmail(eventId, target, item = null) {
  if (item) holdItem(item);   // the question leaves Focus at once ("Saving…"); Notion takes seconds
  const result = await window.pilot.reassignEmail(eventId, target).catch(error => ({ok: false, text: error.message}));
  toastMessage(result.ok ? 'Saved ✓' : 'Not changed', result.text || '');
  if (result.ok) { loadFocus(); loadJobs(); } else if (item) releaseItem(item);
  return result.ok;
}

// Focus → Other job…: the question's email, to the job you pick.
export function whichJob(item) {
  targets('', item.suggested_url);
  pending = () => moveEmail(item.event_id, $('reassign-target').value, item);
  open({title: 'Which job is this email about?', context: item.detail,
    help: 'The job you pick moves on with this email (stage, interview date). "Not in my list yet" tracks it from the email; Focus then asks for its details.'});
}

export async function init() {
  searchSelect($('reassign-target'));
  $('reassign-save').addEventListener('click', async event => {
    event.preventDefault();
    if (!pending) return;
    $('reassign-save').disabled = true;
    message('reassign-message', 'Saving to Notion…', 'waiting');
    const ok = await pending();
    $('reassign-save').disabled = false;
    if (ok) $('reassign-dialog').close(); else message('reassign-message', 'Not saved. Try again.', 'error');
  });
}
