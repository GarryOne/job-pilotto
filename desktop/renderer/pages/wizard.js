// The setup wizard.
import {shared} from './shared.js';
import {refreshCv} from './activity.js';
import {$, STEPS, message, show} from './core.js';
import {loadJobs} from './jobs.js';
import {toDraft} from './strategy-review.js';
import {mountEngine} from './ai-engine.js';
import {canContinue} from '../ai-engine-view.js';

// The AI step's engine chooser (pages/ai-engine.js): mounted the first time the step opens. Nothing is pre-selected;
// Continue once the user picked one that can run (Claude Code verified, or an API key saved or typed).
let chooser = null;
const aiDone = () => !!shared.state.secrets.ANTHROPIC_API_KEY || shared.state.settings.aiEngine === 'cli';
function aiStep() {
  const picked = chooser?.picked();
  show($('ai-key-part'), picked === 'api');
  show($('ai-trial'), picked !== 'cli');  // the free credit stays for people with neither
  const keyTyped = !!$('anthropic-key').value.trim();
  $('ai-save').disabled = !canContinue({picked, hasKey: !!shared.state.secrets.ANTHROPIC_API_KEY, keyTyped, status: chooser?.status()});
  $('ai-save').textContent = picked === 'api' && keyTyped ? 'Check and save' : 'Continue';
}

// ---------- wizard ----------
export function goStep(name) {
  const index = STEPS.indexOf(name);
  window.pilot.saveSettings({wizardStep: name});  // reopening the app continues here
  if (name === 'ai' && shared.state.secrets.ANTHROPIC_API_KEY && !$('anthropic-key').value) {
    message('ai-message', '✓ Your key is saved. Continue, or paste a new key to replace it.', 'ok');
    // The saved key, masked (dots and its last 4 characters), as in Settings.
    window.pilot.secretHints().then(hints => {
      if (hints.ANTHROPIC_API_KEY) $('anthropic-key').placeholder = `${hints.ANTHROPIC_API_KEY} · saved (paste a new one to replace it)`;
    });
  }
  if (name === 'extras') import('./settings.js').then(settings => settings.showExtrasStatus());  // Connected / Manage, as in Settings
  if (name === 'ai') {
    if (!chooser) chooser = mountEngine($('ai-engine'), {context: 'wizard', onChange: aiStep});
    aiStep();
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
  document.querySelectorAll('[data-next]').forEach(b => b.addEventListener('click', () => goStep(aiDone() ? 'cv' : 'ai')));
  document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => {
    const current = STEPS.find(step => !document.querySelector(`.step[data-step="${step}"]`).hidden);
    goStep(STEPS[Math.max(0, STEPS.indexOf(current) - 1)]);
  }));

  $('anthropic-key').addEventListener('input', aiStep);
  $('ai-save').addEventListener('click', async () => {
    if (chooser?.picked() === 'cli') {  // the user's own Claude Code, verified: no API key needed
      shared.state.settings = await window.pilot.setAiEngine('cli');
      message('ai-message', '', '');
      goStep('cv');
      return;
    }
    const key = $('anthropic-key').value.trim();
    if (!key && shared.state.secrets.ANTHROPIC_API_KEY) {  // saved earlier: just continue
      shared.state.settings = await window.pilot.setAiEngine('api');
      goStep('cv');
      return;
    }
    if (!key.startsWith('sk-ant-')) { message('ai-message', 'Anthropic keys start with sk-ant-. Copy the whole key.', 'error'); return; }
    $('ai-save').disabled = true;
    message('ai-message', 'Checking the key…');
    const result = await window.pilot.checkAnthropic(key);
    $('ai-save').disabled = false;
    if (!result.ok) { message('ai-message', result.error, 'error'); return; }
    shared.state.secrets = await window.pilot.saveSecret('ANTHROPIC_API_KEY', key);
    shared.state.settings = await window.pilot.setAiEngine('api');
    $('anthropic-key').value = '';
    message('ai-message', 'Saved ✓', 'ok');
    goStep('cv');
  });
  $('ai-skip').addEventListener('click', () => goStep('cv'));
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
    setTimeout(() => goStep('cv'), 900);
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
