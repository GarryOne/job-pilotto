// "Read this board" (owner, 16 Oct 2026): a job list behind a login (LinkedIn and the like) read through a tab the app opens and manages in the person's own
// Chrome. The card sits beside "Find jobs using your browser" (built here, not in index.html, which may only shrink); Run opens a small dialog for the board's
// search address, or one of the sites the app knows; the tab waits for the person's Read (extension popup), after they sign in themselves. Guard: desktop/test/read-board.test.js.
import {el} from '../components.js';
import {icon} from '../icons.js';
import {$, show} from './core.js';
import {refreshActivity} from './activity.js';
import {validBoard} from '../board-address.js';

const hold = button => { button.disabled = true; button.dataset.runBusy = '1'; };   // syncRunButtons (runs-page.js) turns it on again when the task ends
const release = button => { button.disabled = false; delete button.dataset.runBusy; };

// The card, the same parts as its siblings (.task-card in index.html), placed after Find jobs using your browser; its Run is in ⌘K (data-palette, nav.js).
export function boardCard() {
  const run = el('button', 'secondary action', '');
  run.id = 'board-run';
  run.dataset.palette = 'board';
  run.append(Object.assign(el('b', '', 'Read this board'), {hidden: true}), 'Run');
  const card = el('div', 'task-card is-row');
  card.id = 'board-card';
  card.append(el('span', 'task-category', 'DISCOVERY'), (() => {
    const body = el('div', 'task-body');
    const words = el('div', 'task-words');
    words.append(el('b', '', 'Read this board'), el('span', 'muted', 'A job list behind a sign-in: opens it in your Chrome, you sign in there, then it reads the list'));
    const tile = el('span', 'task-tile');
    tile.append(icon('globe'));
    body.append(tile, words, run);
    return body;
  })());
  return card;
}

// The dialog: the board's search address (typed or pasted), or a site the app knows from its list.
export function boardDialog() {
  const dialog = el('dialog', 'save-dialog panel-dialog cv-dialog board-dialog');
  dialog.id = 'board-dialog';
  const head = el('div', 'dialog-head');
  const lead = el('div', 'cv-head');
  lead.append(el('h2', '', 'Read this board'));
  const close = el('button', 'ghost icon-btn', '');
  close.id = 'board-close';
  close.setAttribute('aria-label', 'Close');
  close.append(icon('close'));
  const tile = el('span', 'dialog-icon');
  tile.append(icon('globe'));
  head.append(tile, lead, close);
  // One left edge under the head: the subtitle, the labelled field, its helper line and the steps (17 Oct 2026: the subtitle touched the field and sat under the title's text).
  const subtitle = el('p', 'dialog-lead', 'Open the board\'s search results in Chrome, as yourself.');
  const label = el('label', '', 'Search results link');
  label.htmlFor = 'board-url';
  const field = el('input', 'board-url');
  Object.assign(field, {id: 'board-url', type: 'url', placeholder: 'https://… the board\'s search results', autocomplete: 'off'});
  field.setAttribute('list', 'board-known');
  field.setAttribute('aria-label', 'The board\'s address');
  const known = el('datalist', '');
  known.id = 'board-known';
  const hint = el('p', 'muted small field-hint', 'The tab opens in your Chrome.');
  const steps = el('ol', 'board-steps muted small', '');
  for (const text of ['Sign in yourself if Chrome asks.', 'Press Read in the Jobadabra extension.', 'Choose "Filter for my search, then read" or "Read the jobs as they are".']) steps.append(el('li', '', text));
  const never = el('p', 'muted small', 'Jobadabra never types your password.');
  const message = el('p', 'message', '');
  message.id = 'board-message';
  const cancel = el('button', 'secondary', 'Cancel');
  cancel.id = 'board-cancel'; cancel.type = 'button';
  const start = el('button', 'primary', 'Open the board');
  start.id = 'board-start'; start.type = 'button'; start.disabled = true;
  const foot = el('div', 'dialog-foot');
  const buttons = el('span', 'inline');
  buttons.append(cancel, start);
  foot.append(el('span', 'muted small', 'You read it; the app keeps the jobs that fit.'), buttons);
  dialog.append(head, subtitle, label, field, known, hint, steps, never, message, foot);
  return dialog;
}

export function initBoard({answer}) {
  const grid = $('actions-more-list') || document.querySelector('.task-grid'), after = $('visits-card');
  if (!grid || $('board-card')) return;
  after ? after.after(boardCard()) : grid.append(boardCard());
  document.body.append(boardDialog());
  const dialog = $('board-dialog'), field = $('board-url');
  field.addEventListener('input', () => { $('board-start').disabled = !validBoard(field.value); });
  $('board-run').addEventListener('click', async () => {
    $('board-message').textContent = '';
    field.value = '';
    $('board-start').disabled = true;
    if (!dialog.open) dialog.showModal();
    field.focus();
    const sites = (await window.pilot.visitsList().catch(() => null))?.visits || [];   // the sites the app knows: offered, never required
    $('board-known').replaceChildren(...sites.map(site => Object.assign(document.createElement('option'), {value: site.url, label: site.name})));
  });
  for (const id of ['board-close', 'board-cancel']) $(id).addEventListener('click', () => dialog.close());
  const start = async () => {
    if (!validBoard(field.value)) return;
    const button = $('board-run');
    dialog.close();
    show($('actions-result'), false);
    hold(button);
    const result = await window.pilot.visitsRun({board: field.value.trim()}).catch(error => ({text: `⚠️ ${error.message}`}));
    if (result?.started) { refreshActivity(); show($('command-answer'), false); return; }
    release(button);
    answer(result?.text || result?.error || 'Done.');
  };
  $('board-start').addEventListener('click', start);
  field.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); start(); } });
}
