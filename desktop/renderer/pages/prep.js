// Interview prep kit (Focus → Prepare): built from the job's description, your Profile and your past interviews,
// on the job's Notion page (src/ai/prep.py). When the role is unknown it asks for the description first.
import {$, message, show} from './core.js';
import {loadFocus, markPrep} from './focus.js';
import {toastMessage} from './startup.js';
import {byStore} from '../store-words.js';

let current = null;   // the Focus item the dialog is for
let step = '';        // the engine's current step (onPrepStep)
// One build at a time per job: closing the dialog doesn't stop it, and reopening joins it (one timer, one AI call),
// instead of starting a second build whose timer would fight the first one on the same line.
let running = null;   // {pageId, started, promise}
let timer = null;

function reset(item) {
  current = item;
  $('prep-title').textContent = `Prepare for ${item.company || item.via || 'the interview'}`;
  $('prep-context').textContent = [item.job, item.badge].filter(Boolean).join(' · ');
  $('prep-text').value = '';
  $('prep-url').value = '';
  show($('prep-describe'), false);
  show($('prep-open'), false);
  message('prep-message', '');
  $('prep-go').disabled = false;
  $('prep-go').textContent = 'Build prep kit';
}

function tick() {
  if (!running || running.pageId !== current?.page_id) return;
  message('prep-message', `${step}… ${Math.round((Date.now() - running.started) / 1000)} s`, 'waiting');
}

async function build() {
  if (!running || running.pageId !== current.page_id) {
    step = 'Starting';
    const pageId = current.page_id;
    running = {pageId, started: Date.now(),
      promise: window.pilot.interviewPrep(pageId).catch(error => ({ok: false, text: error.message}))};
    markPrep(pageId, 'building');
    running.promise.then(result => markPrep(pageId, result.ok ? 'ready' : 'idle'));  // the row, even with the dialog closed
  }
  const mine = running;
  clearInterval(timer);
  timer = setInterval(tick, 1000);
  tick();
  $('prep-go').disabled = true;
  const result = await mine.promise;
  if (running === mine) { running = null; clearInterval(timer); }
  if (current?.page_id !== mine.pageId) return;  // the dialog shows another job now
  $('prep-go').disabled = false;
  if (result.needs_description) {
    show($('prep-describe'), true);
    $('prep-go').textContent = 'Save and build';
    message('prep-message', result.text, 'info');
    $('prep-text').focus();
    return;
  }
  message('prep-message', result.text || '', result.ok ? 'ok' : 'error');
  if (result.ok) {
    show($('prep-open'), !!current.notion_url);
    $('prep-go').textContent = 'Build again';
    toastMessage('Prep kit ready ✓', `${current.company || current.via || ''} · ${current.job}: on the job's ${byStore('Notion page', 'page')}.`);
    loadFocus();
  }
}

// The build running for a job, or null: Recent activity's interview card shows "Building…" until it settles.
export const prepRunning = pageId => (running?.pageId === pageId ? running.promise : null);
export function openPrep(item) {
  markPrep(item.page_id, 'building');  // the row changes before the dialog opens
  reset(item);
  $('prep-dialog').showModal();
  build();
}

export async function init() {
  window.pilot.onPrepStep(text => { step = text; });
  $('prep-open').addEventListener('click', () => current?.notion_url && window.pilot.openExternal(current.notion_url));
  $('prep-go').addEventListener('click', async event => {
    event.preventDefault();
    if (!current) return;
    if (!$('prep-describe').hidden) {
      const text = $('prep-text').value.trim(), url = $('prep-url').value.trim();
      if (!text && !url) { message('prep-message', 'Paste the job description or its link.', 'error'); return; }
      $('prep-go').disabled = true;
      message('prep-message', 'Saving the description on the job…', 'waiting');
      const saved = await window.pilot.describeJob(current.page_id, text, url).catch(error => ({ok: false, text: error.message}));
      $('prep-go').disabled = false;
      if (!saved.ok) { message('prep-message', saved.text, 'error'); return; }
      show($('prep-describe'), false);
    }
    build();
  });
}
