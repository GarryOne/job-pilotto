// Strategy → Improve your search → "N active jobs were scored with other places" (owner, 17 Oct 2026: "mark existing scores as based on previous
// preferences and offer an explicit refresh for active jobs"; a change of places never re-scores by itself). One row with a Refresh button; its dialog
// says what happens first (an AI score per job, once, 60 per search; the cost only when it is known). Guarded by test/locations-refresh.test.js.
import {el} from '../components.js';
import {$} from './core.js';
import {startSearch} from './jobs.js';
import {toastMessage} from './startup.js';

let busy = false;
export const rowTitle = count => `${count} job${count === 1 ? ' was' : 's were'} scored with other places`;
export const dialogLead = count => `They are scored again with your current locations, with AI, once. A search starts now and scores up to 60 of them${count > 60 ? '; the rest in the next searches' : ''}. ` +
  'Cost: not calculated. Applied, rejected and archived jobs are left as they are, and nothing else changes.';

// row: the page's improveRow(glyph, tone, title, text, button); reload: redraws Strategy after the refresh.
export function refreshRow(count, row, reload) {
  const go = el('button', 'secondary item-action', busy ? 'Refreshing…' : 'Refresh scores');
  go.type = 'button';
  go.disabled = busy;
  go.addEventListener('click', () => confirmRefresh(count, reload));
  return row('refresh', 'teal', rowTitle(count), 'Active jobs · Based on previous preferences · Updating is optional', go);
}

function confirmRefresh(count, reload) {
  const dialog = $('rescore-dialog');
  $('rescore-title').textContent = `Refresh ${count} score${count === 1 ? '' : 's'}?`;
  $('rescore-lead').textContent = dialogLead(count);
  $('rescore-go').textContent = `Refresh ${count}`;
  dialog.returnValue = '';
  dialog.onclose = async () => {
    if (dialog.returnValue !== 'go' || busy) return;
    busy = true;
    reload();
    try {
      const result = await window.pilot.refreshLocations().catch(error => ({ok: false, error: error.message}));
      if (!result.ok) { toastMessage('Not refreshed', result.error); return; }
      toastMessage({title: 'Refreshing scores', body: `${result.queued} jobs get a new score in a refresh${result.queued > 60 ? ' (60 now, the rest in the next one)' : ''}.`, target: null});
      await startSearch({reason: 'rescore', count: result.queued});
    } finally {
      busy = false;
      reload();
    }
  };
  dialog.showModal();
}
