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
  // Find jobs using your browser (owner, 7 Oct 2026): Run opens a dialog with the sites from the engine, all ticked but the ones read in the
  // last week; "Read N sites" opens them in Chrome `at once` at a time, where the extension filters and reads each; a tracked task like
  // Tailor CVs. The card itself is only Run, the same size as its siblings. How many at a time and the filter are remembered (this Mac).
  const VISIT_PREFS = 'visits-dialog', plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  try {
    const saved = JSON.parse(localStorage.getItem(VISIT_PREFS) || '{}');
    if (saved.atOnce) $('visits-at-once').value = saved.atOnce;
    if (typeof saved.filter === 'boolean') $('visits-filter').checked = saved.filter;
  } catch {}
  const visitBoxes = () => [...document.querySelectorAll('#visits-sites input[type=checkbox]')];
  const countVisits = () => {
    const ticked = visitBoxes().filter(box => box.checked).length, all = visitBoxes().length;
    $('visits-lead').textContent = all ? `${plural(all, 'site')} · ${ticked} selected (the ones not read this week)` : 'No sites to read yet.';
    $('visits-start').textContent = `Read ${plural(ticked, 'site')}`;
    $('visits-start').disabled = !ticked;
  };
  const paintVisits = async () => {
    $('visits-lead').textContent = 'Reading your sites…';
    $('visits-start').disabled = true;
    const answer = await window.pilot.visitsList().catch(() => null);
    const sites = answer?.visits || [];
    $('visits-sites').replaceChildren(...sites.map(site => {
      const row = document.createElement('li');
      const label = document.createElement('label');
      label.className = 'check-row';   // the shared checkbox row (components.css), inside the shared item-rows list
      const box = Object.assign(document.createElement('input'), {type: 'checkbox', checked: site.kind === 'portal' || !site.last_read, value: site.url});
      box.addEventListener('change', countVisits);
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
    countVisits();
  };
  $('visits-run').addEventListener('click', () => {
    if (!$('visits-dialog').open) $('visits-dialog').showModal();
    paintVisits();
  });
  for (const id of ['visits-close', 'visits-cancel']) $(id).addEventListener('click', () => $('visits-dialog').close());
  $('visits-all').addEventListener('click', () => { for (const box of visitBoxes()) box.checked = true; countVisits(); });
  $('visits-none').addEventListener('click', () => { for (const box of visitBoxes()) box.checked = false; countVisits(); });
  $('visits-start').addEventListener('click', async () => {
    const urls = visitBoxes().filter(box => box.checked).map(box => box.value);
    const atOnce = Math.min(5, Math.max(1, Number($('visits-at-once').value) || 2)), filter = $('visits-filter').checked;
    try { localStorage.setItem(VISIT_PREFS, JSON.stringify({atOnce, filter})); } catch {}
    $('visits-dialog').close();
    const button = $('visits-run');
    show($('actions-result'), false);
    hold(button);
    const result = await window.pilot.visitsRun({urls, atOnce, filter}).catch(error => ({text: `⚠️ ${error.message}`}));
    if (result?.started) { refreshActivity(); show($('command-answer'), false); return; }
    release(button);
    answer(result?.text || result?.error || 'Done.');
  });
  $('visits-at-once').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); if (!$('visits-start').disabled) $('visits-start').click(); } });
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
