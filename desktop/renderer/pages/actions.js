// Actions: every Telegram command.
import {shared} from './shared.js';
import {COMMAND_KIND, openActivity, refreshActivity} from './activity.js';
import {$, message, show} from './core.js';
import {openCvChange, showCvChanged} from './cv-change.js';
import {openView} from './nav.js';
import {showStatusCard} from './runs-page.js';

// ---------- actions (every Telegram command) ----------
export function answer(text) { const box = $('command-answer'); show(box); box.textContent = text; box.scrollIntoView({behavior: 'smooth'}); }
// Lists the app already shows: the Jobs list with that filter (the Telegram bot sends them as messages).
const COMMAND_FILTER = {saved: 'saved', applied: 'applied'};

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  document.querySelectorAll('[data-command]').forEach(button => button.addEventListener('click', async () => {
    const command = button.dataset.command;
    if (COMMAND_FILTER[command]) {
      openView('jobs');
      $('filter-status').value = COMMAND_FILTER[command];
      $('filter-status').dispatchEvent(new Event('change'));
      return;
    }
    // Only a task that runs in the background opens Recent activity (its row and log); an instant answer
    // (Status, Help) shows right here, not behind the panel.
    const task = !!COMMAND_KIND[command];
    if (task) {
      // On the Actions page its banner and Recent runs follow it; from elsewhere (⌘K), Recent activity opens.
      if (document.querySelector('.view[data-view="actions"]').hidden) openActivity(true);
      shared.awaitedRun = {kind: COMMAND_KIND[command], since: Date.now() - 2000};
      show($('actions-result'), false);  // the last result makes way for the one coming
      refreshActivity();
    }
    if (command === 'status') { showStatusCard(); return; }
    button.disabled = true;
    const result = await window.pilot.command(command);
    button.disabled = false;
    if (task && !/^⚠️/.test(result?.text || '')) { refreshActivity(); show($('command-answer'), false); return; }  // its row, then its result, show in Recent activity
    answer(result.text + (result.telegram ? '\n\n(Also sent to Telegram.)' : ''));
  }));
  // Replace CV: the new file is used for uploads at once; the review of what it changes in the Profile (and so in
  // the fit scores) is offered, never applied by itself.
  $('replace-cv').addEventListener('click', async () => {
    const name = await window.pilot.chooseCv();
    if (!name) return;
    shared.state = await window.pilot.state();
    $('contact-cv').textContent = name;
    message('strategy-message', `CV replaced: ${name}. New applications use it now. Review what it changes in your strategy when you're ready.`, 'ok');
    showCvChanged();
  });
  $('strategy-cv-review').addEventListener('click', openCvChange);
}
