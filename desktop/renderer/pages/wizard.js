// The setup wizard.
import {shared} from './shared.js';
import {refreshCv} from './activity.js';
import {$, STEPS, message, show} from './core.js';
import {loadJobs} from './jobs.js';
import {showDraftCost, toDraft} from './strategy-review.js';

// ---------- wizard ----------
export function goStep(name) {
  const index = STEPS.indexOf(name);
  window.pilot.saveSettings({wizardStep: name});  // reopening the app continues here
  if (name === 'goals') showDraftCost();
  if (name === 'ai' && shared.state.secrets.ANTHROPIC_API_KEY && !$('anthropic-key').value) {
    message('ai-message', '✓ Your key is saved. Continue, or paste a new key to replace it.', 'ok');
    // The saved key, masked (dots and its last 4 characters), as in Settings.
    window.pilot.secretHints().then(hints => {
      if (hints.ANTHROPIC_API_KEY) $('anthropic-key').placeholder = `${hints.ANTHROPIC_API_KEY} · saved (paste a new one to replace it)`;
    });
  }
  if (name === 'notion') showNotionNext();
  // Reviewing a finished setup: the workspace stays as it is (switching it is Settings → Notion).
  const reviewing = !!shared.state.settings.setupDone && !!shared.state.notion;
  $('notion-oauth').disabled = reviewing;
  document.querySelector('.step[data-step="notion"] .oauth').classList.toggle('locked', reviewing);
  if (name === 'ai') $('ai-save').textContent = shared.state.secrets.ANTHROPIC_API_KEY && !$('anthropic-key').value ? 'Continue' : 'Check and save';
  if (name === 'notion' && (notionReady() || reviewing) && !$('notion-key').value) {
    message('notion-message', reviewing ? '✓ Connected to your Job Pilotto workspace. To connect a different one: Settings → Notion.'
      : '✓ Connected to your Job Pilotto workspace. Continue, or connect again.', 'ok');
  }
  document.querySelectorAll('.step').forEach(step => show(step, step.dataset.step === name));
  document.querySelectorAll('#step-list li').forEach((li, i) => {
    li.classList.toggle('current', i === index);
    li.classList.toggle('done', i < index || !!shared.state.settings.setupDone);
    li.classList.toggle('jump', !!shared.state.settings.setupDone || i < index);
  });
  show($('wizard-exit'), !!shared.state.settings.setupDone);
  show($('review-mode'), !!shared.state.settings.setupDone);  // setup done before: this is a review, not a redo
  $('draft-save').textContent = shared.state.settings.setupDone ? 'Replace my strategy…' : 'Save strategy & continue';
  if (name === 'cv') refreshCv();
}

const notionReady = () => !!shared.state.notion && Object.keys(shared.state.notion).length >= 11;
// Connected earlier (e.g. setup run again): Continue without connecting again.
function showNotionNext() { show($('notion-next'), notionReady() || (!!shared.state.settings.setupDone && !!shared.state.notion)); }
async function showNotionResult(result) {
  const found = $('notion-found');
  found.replaceChildren();
  if (result.titles) {
    show(found);
    for (const [env, title] of Object.entries(result.titles)) {
      const ok = result.ids?.[env];
      found.append(Object.assign(document.createElement('div'), {className: ok ? 'yes' : 'no', textContent: `${ok ? '✓' : '✗'} ${title}`}));
    }
  }
  if (result.ok) {
    $('notion-key').value = '';
    shared.state = await window.pilot.state();
    message('notion-message', `Connected ✓ ${result.workspace ? `${result.workspace}: ` : ''}your workspace is ready.`, 'ok');
    setTimeout(() => goStep('cv'), 900);
  } else if (result.error) {
    message('notion-message', result.error, 'error');
  } else if (result.missing?.length) {
    message('notion-message', 'The connection can\'t see your Job Pilotto page yet, or sees more than one page. Click Connect with Notion again and keep "Use a template provided by the developer" (or tick only your Job Pilotto page). Notion can take a minute: try again shortly.', 'error');
  } else {
    message('notion-message', `Columns are missing: ${result.problems.map(p => `${p.title} (${p.missing.slice(0, 3).join(', ')})`).join('; ')}. Duplicate the template again rather than editing columns.`, 'error');
  }
}

// The save window: a step is ● while it runs (with blocks written), ✓ when it's done; the bar sums them.
const SAVE_STEPS = {snapshot: 15, local: 5, profile: 40, answers: 25, search: 15};
export const saveState = {};

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  // Finished steps (or any step once setup was done before) can be opened from the sidebar.
  document.querySelectorAll('#step-list li').forEach(li => li.addEventListener('click', () => {
    if (!li.classList.contains('jump') || li.classList.contains('current')) return;
    if (li.dataset.step === 'draft') toDraft(); else goStep(li.dataset.step);
  }));
  // Setup was done before (Run setup again, Rebuild from CV): leave the wizard any time, nothing changes.
  $('wizard-exit').addEventListener('click', () => { show($('wizard'), false); show($('app')); loadJobs(); });
  // A key already there (e.g. the free credit from the one-command install): no AI step to do.
  document.querySelectorAll('[data-next]').forEach(b => b.addEventListener('click', () => goStep(shared.state.secrets.ANTHROPIC_API_KEY ? 'notion' : 'ai')));
  document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => {
    const current = STEPS.find(step => !document.querySelector(`.step[data-step="${step}"]`).hidden);
    goStep(STEPS[Math.max(0, STEPS.indexOf(current) - 1)]);
  }));

  $('anthropic-key').addEventListener('input', () => {
    $('ai-save').textContent = shared.state.secrets.ANTHROPIC_API_KEY && !$('anthropic-key').value.trim() ? 'Continue' : 'Check and save';
  });
  $('ai-save').addEventListener('click', async () => {
    const key = $('anthropic-key').value.trim();
    if (!key && shared.state.secrets.ANTHROPIC_API_KEY) { goStep('notion'); return; }  // saved earlier: just continue
    if (!key.startsWith('sk-ant-')) { message('ai-message', 'Anthropic keys start with sk-ant-. Copy the whole key.', 'error'); return; }
    $('ai-save').disabled = true;
    message('ai-message', 'Checking the key…');
    const result = await window.pilot.checkAnthropic(key);
    $('ai-save').disabled = false;
    if (!result.ok) { message('ai-message', result.error, 'error'); return; }
    shared.state.secrets = await window.pilot.saveSecret('ANTHROPIC_API_KEY', key);
    $('anthropic-key').value = '';
    message('ai-message', 'Saved ✓', 'ok');
    goStep('notion');
  });
  $('ai-skip').addEventListener('click', () => goStep('notion'));
  // The free AI credit (lib/ai-trial.js): the founder key unlocks the app and pays for the first $1 of AI.
  $('ai-trial-go').addEventListener('click', async () => {
    const pasted = $('ai-trial-key').value.trim();
    if (pasted) {
      const set = await window.pilot.licenseSet(pasted).catch(error => ({ok: false, error: error.message}));
      if (set && set.ok === false) { message('ai-message', set.error || 'That key was not accepted.', 'error'); return; }
    }
    const result = await window.pilot.startTrialCredit();
    if (!result.ok) { message('ai-message', result.error, 'error'); return; }
    shared.state.secrets = {...shared.state.secrets, ANTHROPIC_API_KEY: true};
    $('ai-trial-key').value = '';
    message('ai-message', '✓ Using your $1 of free AI. Add your own key any time in Settings → Anthropic.', 'ok');
    setTimeout(() => goStep('notion'), 900);
  });

  // Notion is required: the wizard continues only when every database and page of the template is found.
  $('notion-template').addEventListener('click', () => window.pilot.openExternal(shared.state.templateUrl));
  $('notion-next').addEventListener('click', () => goStep('cv'));
  $('notion-oauth').addEventListener('click', async () => {
    $('notion-oauth').disabled = true;
    message('notion-message', 'Waiting for Notion: approve in your browser, then come back here…', 'waiting');
    const result = await window.pilot.notionOAuth();
    $('notion-oauth').disabled = false;
    // It didn't work: now offer the token way (hidden until then; Connect with Notion is enough for nearly everyone).
    if (!result.ok && !result.titles) { message('notion-message', result.error || 'Not connected.', 'error'); show($('notion-manual')); return; }
    if (!result.ok) show($('notion-manual'));
    showNotionResult(result);
  });
  $('notion-connect').addEventListener('click', async () => {
    const key = $('notion-key').value.trim();
    if (!key) { message('notion-message', 'Paste the API token from step 2.', 'error'); return; }
    $('notion-connect').disabled = true;
    message('notion-message', 'Looking for your Job Pilotto workspace…', 'waiting');
    const result = await window.pilot.notionConnect(key);
    $('notion-connect').disabled = false;
    showNotionResult(result);
  });

  window.pilot.onNotionProgress(({found, total, ids, titles, building, waitingPage, template}) => {
    if (building) { show($('notion-found'), false); message('notion-message', 'Connected ✓ Building your Job Pilotto workspace in Notion (databases, columns, pages)… about a minute.', 'waiting'); return; }
    if (waitingPage) { show($('notion-found'), false); message('notion-message', 'Waiting for Notion to share your Job Pilotto page with the app…', 'waiting'); return; }
    message('notion-message', template
      ? `Connected ✓ Notion is copying the Job Pilotto template into your workspace: ${found} of ${total} ready. About a minute; the app keeps checking.`
      : `Notion is still sharing your workspace with the connection: ${found} of ${total} found. This can take a minute; the app keeps checking.`, 'waiting');
    const list = $('notion-found');
    list.replaceChildren();
    show(list);
    for (const [env, title] of Object.entries(titles)) {
      list.append(Object.assign(document.createElement('div'), {className: ids[env] ? 'yes' : 'pending', textContent: `${ids[env] ? '✓' : '…'} ${title}`}));
    }
  });

  // What's happening, line by line: finished pieces ✓, the one being written last.
  window.pilot.onDraftProgress(({part, percent, notes = []}) => {
    $('draft-feed').replaceChildren(...notes.slice(-9).map((note, i, shown) => Object.assign(document.createElement('li'),
      {className: i === shown.length - 1 ? 'now' : 'done', textContent: note})));
    $('draft-part').textContent = part;
    if (percent == null) return;
    $('draft-percent').textContent = percent ? `${percent}%` : '';
    $('draft-bar').style.width = `${Math.max(2, percent)}%`;
  });
  window.pilot.onSaveProgress(({step, done, total, finished}) => {
    saveState[step] = finished ? 1 : total ? done / total : saveState[step] || 0;
    document.querySelectorAll('#save-steps li').forEach(li => {
      const name = li.dataset.saveStep, value = saveState[name];
      li.className = value === 1 ? 'done' : value !== undefined ? 'now' : '';
      const count = li.querySelector('.count');
      if (count) count.textContent = name === step && total && !finished ? `· ${done} of ${total} blocks` : '';
    });
    const percent = Object.entries(SAVE_STEPS).reduce((sum, [name, share]) => sum + share * (saveState[name] || 0), 0);
    $('save-bar').style.width = `${Math.max(3, Math.round(percent))}%`;
  });
}
