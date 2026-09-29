// Interview prep kit (Focus → Prepare): built from the job's description, your Profile and your past interviews,
// on the job's Notion page (src/ai/prep.py). When the role is unknown it asks for the description first.
import {$, message, show} from './core.js';
import {loadFocus} from './focus.js';
import {toastMessage} from './startup.js';

let current = null;   // the Focus item the dialog is for
let step = '';        // the engine's current step (onPrepStep)

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

async function build() {
  const started = Date.now();
  step = 'Starting';
  const tick = () => message('prep-message', `${step}… ${Math.round((Date.now() - started) / 1000)} s`, 'waiting');
  tick();
  const timer = setInterval(tick, 1000);
  $('prep-go').disabled = true;
  const result = await window.pilot.interviewPrep(current.page_id).catch(error => ({ok: false, text: error.message}))
    .finally(() => clearInterval(timer));
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
    toastMessage('Prep kit ready ✓', `${current.company || current.via || ''} · ${current.job}: on the job's Notion page.`);
    loadFocus();
  }
}

export function openPrep(item) {
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
