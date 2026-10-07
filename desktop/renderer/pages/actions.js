// Actions: every Telegram command.
import {shared} from './shared.js';
import {COMMAND_KIND, openActivity, refreshActivity} from './activity.js';
import {$, message, show} from './core.js';
import {openCvChange, showCvChanged} from './cv-change.js';
import {openView} from './nav.js';
import {showStatusCard} from './runs-page.js';

// A pressed task button is held off (syncRunButtons in runs-page.js turns it on again when its task ends); a refusal releases it at once.
const hold = button => { button.disabled = true; button.dataset.runBusy = '1'; };
const release = button => { button.disabled = false; delete button.dataset.runBusy; };

// ---------- actions (every Telegram command) ----------
export function answer(text) { const box = $('command-answer'); delete box.dataset.fallback; show(box); box.textContent = text; box.scrollIntoView({behavior: 'smooth'}); }
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
      show($('actions-result'), false);  // the last result makes way for the one coming
      refreshActivity();
    }
    if (command === 'status') { showStatusCard(); return; }
    hold(button);
    const result = await window.pilot.command(command);
    if (task && !/^⚠️/.test(result?.text || '')) { refreshActivity(); show($('command-answer'), false); return; }   // a started task keeps its button off until it ends (syncRunButtons)
    release(button);  // its row, then its result, show in Recent activity
    answer(result.text + (result.telegram ? '\n\n(Also sent to Telegram.)' : ''));
  }));
  // Tailor CVs for top matches: a tracked task like the others, so the banner, Recent activity and the result follow it; only a refusal (Notion, allowance, nothing to do) is answered here.
  $('tailor-top').addEventListener('click', async event => {
    const button = event.currentTarget, count = Math.max(1, Math.min(10, Number($('tailor-top-n').value) || 5));
    show($('actions-result'), false);
    hold(button);
    const result = await window.pilot.tailorTop(count).catch(error => ({text: `⚠️ ${error.message}`}));
    if (result?.started) { refreshActivity(); show($('command-answer'), false); return; }   // the Actions page keeps Run off while the task runs, and on again when it ends
    release(button);
    answer(result?.text || result?.error || 'Done.');
  });
  $('tailor-top-n').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); $('tailor-top').click(); } });   // Enter in the count box = Run
  // Read sites only you can open (owner, 7 Oct 2026): the list from the engine, all ticked but the ones read in the last week; Run opens them
  // in Chrome `at once` at a time, where the extension filters and reads each by itself; a tracked task like Tailor CVs.
  const paintVisits = async () => {
    const answer = await window.pilot.visitsList().catch(() => null);
    const sites = answer?.visits || [];
    const list = $('visits-sites');
    show(list, sites.length > 0);
    list.replaceChildren(...sites.map(site => {
      const row = document.createElement('li');
      const label = document.createElement('label');
      label.className = 'check-row';   // the shared checkbox row (components.css), inside the shared item-rows list
      const box = Object.assign(document.createElement('input'), {type: 'checkbox', checked: site.kind === 'portal' || !site.last_read, value: site.url});
      const words = document.createElement('span');
      const name = document.createElement('b');
      name.textContent = site.kind === 'portal' ? `${site.name} · your search` : `${site.name} (${new URL(site.url).hostname.replace(/^www\./, '')})`;
      const when = document.createElement('span');
      when.className = 'muted';
      when.textContent = site.last_read ? `read ${site.last_read.slice(0, 10)}` : 'never read';
      if (site.note) when.title = site.note;
      words.append(name, when);
      label.append(box, words);
      row.append(label);
      return row;
    }));
    $('visits-run').disabled = !sites.length;
    const count = $('visits-count');
    count.textContent = sites.length > 4 ? `${sites.length} sites · scroll to see all` : '';
    show(count, sites.length > 4);
  };
  paintVisits();
  document.querySelector('.nav[data-view=actions]')?.addEventListener('click', paintVisits);
  $('visits-run').addEventListener('click', async event => {
    const button = event.currentTarget;
    const urls = [...document.querySelectorAll('#visits-sites input:checked')].map(box => box.value);
    show($('actions-result'), false);
    hold(button);
    const result = await window.pilot.visitsRun({urls, atOnce: Number($('visits-at-once').value) || 2, filter: $('visits-filter').checked})
      .catch(error => ({text: `⚠️ ${error.message}`}));
    if (result?.started) { refreshActivity(); show($('command-answer'), false); return; }
    release(button);
    answer(result?.text || result?.error || 'Done.');
  });
  $('visits-at-once').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); $('visits-run').click(); } });
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
