// Jobs page, the saved views and List | Board: one chip per view of the Applications database (jobs-board-rules.js VIEWS, with its count),
// and the toggle between the list and the board (pages/jobs-board.js). renderJobs (jobs-render.js) calls paintViews at its end.
// Guarded by: test/jobs-board-rules.test.js (the rules), test/jobs-board-page.test.js (this wiring).
import {el} from '../components.js';
import {VIEWS} from '../jobs-board-rules.js';
import {shared} from './shared.js';
import {$, show} from './core.js';
import {jobsState} from './jobs-state.js';
import {renderBoard} from './jobs-board.js';

const MODE_KEY = 'jobsMode';

function renderChips() {
  const now = Date.now();
  $('jobs-views').replaceChildren(...VIEWS.map(view => {
    const count = shared.allJobs.filter(job => view.test(job, now)).length;
    const chip = Object.assign(el('button', 'chip-button'), {type: 'button', title: view.title});
    chip.dataset.view = view.id;
    chip.setAttribute('aria-pressed', String(jobsState.view === view.id));
    chip.append(el('span', '', view.label), el('span', 'chip-count', String(count)));
    return chip;
  }));
}

// The end of every renderJobs: the chips, the toggle, and the list or the board. boardJobs = what the board shows (Applications rows,
// narrowed by the view or counter and the search words).
export function paintViews(boardJobs) {
  renderChips();
  const board = jobsState.mode === 'board';
  document.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === jobsState.mode)));
  show($('jobs-board'), board);
  show($('jobs-split'), !board);
  document.querySelector('[data-density]').parentElement.hidden = board;   // density is the list's
  // The board shows your applications whatever the menu says (as the Pipeline board in Notion): the menu steps aside.
  $('filter-status').disabled = board;
  $('filter-status').title = board ? 'The board shows every application; a saved view narrows it' : '';
  if (!board) return;
  $('jobs-head').hidden = true;
  show($('jobs-more'), false);
  $('jobs-count').textContent = `${boardJobs.length} application${boardJobs.length === 1 ? '' : 's'} on the board`;
  show($('jobs-empty'), false);
  renderBoard(boardJobs);
}

// A board card's click: the job's drawer, over the board.
export function openFromBoard(open) {
  open();
}

function setMode(mode, render = true) {
  jobsState.mode = mode === 'board' ? 'board' : 'list';
  try { localStorage.setItem(MODE_KEY, jobsState.mode); } catch {}
  if (jobsState.mode !== 'board') $('jobs-head').hidden = $('jobs-body').classList.contains('compact');
  if (render) document.dispatchEvent(new CustomEvent('jobs-rerender'));
}

export function wireViews() {
  try { jobsState.mode = localStorage.getItem(MODE_KEY) === 'board' ? 'board' : 'list'; } catch {}
  $('jobs-views').addEventListener('click', event => {
    const chip = event.target.closest('[data-view]');
    if (!chip) return;
    jobsState.view = jobsState.view === chip.dataset.view ? null : chip.dataset.view;   // the pressed one again: every job
    if (jobsState.view) {   // one narrowing at a time, as with the counters; the menu shows both kinds (inbound rows are in the views too)
      jobsState.statFilter = null;
      $('filter-status').value = 'everything';
    }
    document.dispatchEvent(new CustomEvent('jobs-rerender'));
  });
  document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
}
