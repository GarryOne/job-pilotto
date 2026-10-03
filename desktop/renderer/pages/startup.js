// Start-up: what the window opens on.
import {shared} from './shared.js';
import {$, show} from './core.js';
import {loadJobs} from './jobs.js';
import {openView, remembered} from './nav.js';
import {settingsPage} from './settings.js';
import {toDraft} from './strategy-review.js';
import {goStep} from './wizard.js';

export function toastMessage(title, body, hint) {
  if (typeof title === 'object') ({title, body, hint} = title);
  // The same message twice (a double click, two checks finding the same thing) replaces the first instead of stacking.
  for (const old of $('toasts').children) if (old.dataset.key === `${title}\n${body}`) old.remove();
  const toast = Object.assign(document.createElement('div'), {className: 'toast'});
  toast.dataset.key = `${title}\n${body}`;
  toast.append(Object.assign(document.createElement('b'), {textContent: title}), Object.assign(document.createElement('span'), {textContent: body}));
  if (hint) toast.append(Object.assign(document.createElement('small'), {textContent:
    window.pilot.platform === 'win32' ? 'Windows notifications are off for this app: Settings → System → Notifications → Job Pilotto → On.'
      : 'macOS notifications are off for this app: System Settings → Notifications → Electron (or Job Pilotto) → Allow notifications.'}));
  toast.addEventListener('click', () => toast.remove());
  $('toasts').append(toast);
  setTimeout(() => toast.remove(), hint ? 20000 : 8000);
  return toast;
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  // ---------- start ----------
  // Set up: the app. Without Notion (Notion later) it is only trying, so it opens on Jobs; the pages that need Notion show a gate.
  if (shared.state.settings.setupDone) {
    show($('app'));
    loadJobs();
    // After a reload (⌘R), the page and Settings section it was on, once all the code below has loaded (every page's
    // state is declared by then); else Focus.
    const view = remembered('view'), section = remembered('settingsPage');
    if (view && view !== 'focus' && document.querySelector(`.view[data-view="${view}"]`)) {
      setTimeout(() => {
        openView(view);
        if (view === 'settings' && section && document.querySelector(`[data-settings-page="${section}"]`)) settingsPage(section);
      }, 0);
    } else openView(shared.state.notion ? 'focus' : 'jobs');
  } else {
    show($('wizard'));
    const saved = shared.state.settings.wizardStep === 'goals' ? 'cv' : shared.state.settings.wizardStep;  // the old goals step: now part of the CV step
    const resume = saved === 'notion' ? 'cv' : saved || 'welcome';  // an install that stopped on the old Notion step carries on at the CV
    if (resume === 'draft') toDraft(); else goStep(resume);
  }

  // In-window notifications (when macOS blocks system ones).
  window.pilot.onToast(toastMessage);

  // Help improve Job Pilotto (opt-in anonymous form reports).
  $('claude-consent').addEventListener('change', async () => {
    shared.state.settings = await window.pilot.saveSettings({claudeConsent: $('claude-consent').checked ? new Date().toISOString() : null});
  });
}
