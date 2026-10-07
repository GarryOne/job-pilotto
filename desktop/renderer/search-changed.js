// "Your search changed": after places, roles, remote or languages are saved on Strategy (main.js editTargets keeps searchChangedAt), Jobs and
// Strategy say a refresh applies it, until one has finished (owner, 7 Oct 2026: after editing the places nothing said the list was stale).
import {startSearch} from './pages/jobs.js';

export const searchChanged = settings => !!settings?.searchChangedAt && Date.parse(settings.searchChangedAt) > Date.parse(settings.lastSearchAt || 0);

export function showSearchChanged(settings) {
  for (const box of document.querySelectorAll('.search-changed')) box.hidden = !searchChanged(settings);
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
