// Focus → "Did the interview happen?" (src/focus.py 'happened': its time passed and nothing was recorded).
// Yes: your notes become a 🎤 Interviews row, the job moves on, and a few lines get Claude's review (on this Mac, or on
// GitHub when Always on). No: moved to a new date (Next interview) or cancelled (an event; the stage stays).
import {shared} from './shared.js';
import {$, aiReady, message, show} from './core.js';
import {loadFocus} from './focus.js';
import {loadJobs} from './jobs.js';
import {toastMessage} from './startup.js';

let current = null;  // {item, answer: 'yes' | 'no'}
const who = item => item.company || item.via || 'the recruiter';

export function openHappened(item, answer) {
  current = {item, answer};
  const at = item.at ? new Date(item.at) : null;
  $('happened-title').textContent = answer === 'yes' ? 'How did it go?' : "The interview didn't happen";
  $('happened-context').textContent = `${who(item)} · ${item.job || 'Interview'}${at ? ` · ${at.toLocaleString([], {weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'})}` : ''}`;
  show($('happened-yes'), answer === 'yes');
  show($('happened-no'), answer !== 'yes');
  $('happened-notes').value = '';
  $('happened-at').value = '';
  $('happened-save').disabled = false;
  message('happened-message', '');
  $('happened-dialog').showModal();
  (answer === 'yes' ? $('happened-notes') : $('happened-at')).focus();
}

// A few lines of notes: Claude reviews them like a transcript (the same review as a recording), in the background.
async function review(pageId, item) {
  if (!aiReady()) {
    toastMessage('Saved ✓', 'Choose your AI in Settings (Claude Code or an API key) to get a review of your notes (Interviews → Review).');
    return;
  }
  toastMessage('Saved ✓', `Claude is reviewing your notes on ${who(item)} (about a minute).`);
  const result = await window.pilot.interviews.review(pageId).catch(error => ({ok: false, error: error.message}));
  toastMessage(result.ok ? 'Interview reviewed' : 'Review failed', result.ok ? result.summary : result.error || 'Try again from Interviews.');
  loadFocus();
  loadJobs();
}

async function save() {
  const {item, answer} = current;
  let detail = {};
  let kind = 'held';
  if (answer === 'yes') detail = {notes: $('happened-notes').value.trim()};
  else {
    kind = document.querySelector('input[name="happened-why"]:checked')?.value || 'moved';
    if (kind === 'moved') {
      const value = $('happened-at').value;
      if (!value) { message('happened-message', 'Pick the new date and time, or choose Cancelled.', 'warn'); return false; }
      detail = {at: new Date(value).toISOString()};
    }
  }
  $('happened-save').disabled = true;
  const result = await window.pilot.interviewHappened(item.page_id, kind, detail).catch(error => ({ok: false, error: error.message}));
  $('happened-save').disabled = false;
  if (!result.ok) { message('happened-message', result.error || 'Notion could not save it. Try again.', 'warn'); return false; }
  $('happened-dialog').close();
  if (kind === 'held' && result.review && result.id) review(result.id, item);
  else toastMessage('Saved ✓', {held: `${who(item)}: marked as held${result.stage ? `, now ${result.stage}` : ''}.`,
    moved: `${who(item)}: the interview is on the new date.`, cancelled: `${who(item)}: logged as cancelled.`}[kind]);
  loadFocus();
  loadJobs();
  return true;
}

export function init() {
  $('happened-at').addEventListener('focus', () => { document.querySelector('input[name="happened-why"][value="moved"]').checked = true; });
  $('happened-save').addEventListener('click', event => { event.preventDefault(); save(); });
}
