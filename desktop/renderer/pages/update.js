// App updates: when a newer stable release exists (lib/updater.js), the menu's foot offers it; one click downloads
// it, swaps the app and restarts (the quit dialog still asks if a job is running).
import {$, show} from './core.js';
import {toastMessage} from './startup.js';

function offer(update) {
  if (!update) return;
  $('nav-update-text').textContent = `Update to ${update.name}`;
  $('nav-update').title = `${update.name} is ready: click to install it and restart. What's new: ${update.url}`;
  show($('nav-update'), true);
}

export async function init() {
  offer(await window.pilot.updateState().catch(() => null));
  window.pilot.onUpdate(offer);
  window.pilot.onUpdateStep(step => { $('nav-update-text').textContent = step; });
  $('nav-update').addEventListener('click', async () => {
    const button = $('nav-update');
    button.disabled = true;
    $('nav-update-text').textContent = 'Preparing…';
    const result = await window.pilot.updateInstall().catch(error => ({ok: false, text: error.message}));
    if (result.ok) return;  // the app quits and reopens updated
    button.disabled = false;
    $('nav-update-text').textContent = 'Update: try again';
    toastMessage("Update didn't install", result.text || 'Try again, or download it from the website.');
  });
}
