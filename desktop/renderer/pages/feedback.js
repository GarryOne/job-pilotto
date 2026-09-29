// Feedback is saved to Notion. Sending stays with the user; Gmail remains read-only.
import {$, message} from './core.js';
import {loadFocus} from './focus.js';
import {loadJobs} from './jobs.js';

let current = null;
export function openFeedback(item, mode = 'receive') {
  current = {...item, mode};
  $('feedback-title').textContent = mode === 'request' ? 'Ask for feedback' : mode === 'review' ? 'Employer feedback' : 'Add employer feedback';
  $('feedback-context').textContent = `${item.company || 'Employer'} · ${item.job || item.title || 'Application'}`;
  $('feedback-help').textContent = mode === 'request'
    ? 'You reached Screening or later. One specific point can improve your next interview. Copy this short request, send it yourself, then mark it sent.'
    : mode === 'review' ? 'Look for one change to practise next. This evidence also feeds your daily insights and weekly report.'
    : 'Paste their feedback at any stage. It stays separate from AI interpretations and feeds your insights and weekly report.';
  $('feedback-text').value = mode === 'request' ? item.draft || '' : mode === 'review' ? item.employer_feedback || '' : '';
  $('feedback-text').readOnly = mode === 'review';
  $('feedback-copy').hidden = mode !== 'request';
  $('feedback-copy').textContent = 'Copy request';
  $('feedback-email').hidden = mode !== 'request' || !item.link;
  $('feedback-save').textContent = mode === 'request' ? 'I sent the request' : mode === 'review' ? 'Mark reviewed' : 'Save feedback';
  $('feedback-save').disabled = false;
  message('feedback-message', '');
  $('feedback-dialog').showModal();
  if (mode !== 'review') $('feedback-text').focus();
}
export async function saveFeedbackAction(item, action, text = '') {
  try {
    const result = await window.pilot.feedbackAction(item.page_id, action, text);
    if (!result.ok) return result;
    await Promise.all([loadFocus(), loadJobs()]);
    return result;
  } catch (error) { return {ok: false, error: error.message || 'Could not save to Notion.'}; }
}
export function init() {
  $('feedback-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('feedback-text').value); $('feedback-copy').textContent = 'Copied ✓'; }
    catch { message('feedback-message', 'Could not copy. Select the text and copy it yourself.', 'warn'); }
  });
  $('feedback-email').addEventListener('click', () => current?.link && window.pilot.openExternal(current.link));
  $('feedback-save').addEventListener('click', async event => {
    event.preventDefault();
    const action = {request: 'request', receive: 'receive', review: 'review'}[current.mode];
    const text = $('feedback-text').value.trim();
    if (action === 'receive' && !text) { message('feedback-message', 'Paste the feedback first.', 'warn'); return; }
    $('feedback-save').disabled = true;
    const result = await saveFeedbackAction(current, action, text);
    $('feedback-save').disabled = false;
    if (result.ok) $('feedback-dialog').close();
    else message('feedback-message', result.error || 'Notion could not save it. Try again.', 'warn');
  });
}
