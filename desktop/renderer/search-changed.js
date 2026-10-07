// "Your search changed": after places, roles, remote or languages are saved on Strategy (main.js editTargets keeps searchChangedAt), Jobs and
// Strategy say a refresh applies it, until one has finished (owner, 7 Oct 2026: after editing the places nothing said the list was stale).
import {startSearch} from './pages/jobs.js';

// Applied only by a refresh that began after the change (7 Oct 2026: a change saved while a refresh ran was taken as applied when that refresh
// ended half a second later, with the old places).
export const searchChanged = settings => !!settings?.searchChangedAt
  && Date.parse(settings.searchChangedAt) > Date.parse(settings.lastSearchStartedAt || settings.lastSearchAt || 0);

let lastSettings = null, refreshing = false;
export function showSearchChanged(settings = lastSettings) {
  lastSettings = settings;
  // A refresh running or queued is already applying it (owner, 7 Oct 2026: the banner stayed while the refresh it asked for ran).
  for (const box of document.querySelectorAll('.search-changed')) box.hidden = refreshing || !searchChanged(settings);
}
// Called with the tasks running or queued (pages/runs-page.js syncRunButtons, the same signal that turns the Refresh buttons off).
export function refreshBusy(busy) {
  if (busy === refreshing) return;
  refreshing = busy;
  showSearchChanged();
}

let wired = false;
export function wireSearchChanged() {
  if (wired) return;
  wired = true;
  for (const button of document.querySelectorAll('[data-refresh-jobs]')) {
    button.addEventListener('click', () => {
      for (const box of document.querySelectorAll('.search-changed')) box.hidden = true;   // a refresh is on its way
      startSearch();
    });
  }
}
