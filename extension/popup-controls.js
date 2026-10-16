// Which toolbar-popup controls a tab gets: none unless the desktop app opened and manages the tab (owner, 16 Oct 2026: "as long I'm not on a tab opened and managed
// by the desktop app. There should be no button present/active"). Every <button> in popup.html starts hidden; popup.js shows only what this returns.
// Guard: desktop/test/extension-popup-controls.test.js (a popup button missing from POPUP_CONTROLS, or shown outside this gate, fails).
export const POPUP_CONTROLS = ['apply-here', 'read-filter', 'read-as-is', 'visit-allow', 'stop'];

// popupMode (tab-pages.js): 'fill' = opened to apply, 'read' = opened to read its jobs, 'board' = opened for "Read this board" (waits for Read); 'browse' and 'none' are the person's own tabs.
export const managedMode = mode => mode === 'fill' || mode === 'read' || mode === 'board';

// The address the popup judges: a read tab whose site redirected and dropped its mark keeps the mark in the session (background.js readWhenLoaded,
// `readmark:<tab>`), so it is still a tab the app opened.
export const judgedUrl = (url, mark) => {
  const href = String(url || '');
  return mark && !href.includes('#jp-') ? `${href.split('#')[0]}${mark}` : href;
};

// -> the ids to show. `allowed`: the extension may run on the tab's site (when not, the Allow button is the one way on).
export function popupControls(mode, {allowed = true} = {}) {
  if (!managedMode(mode)) return [];
  if (!allowed) return ['visit-allow', 'stop'];
  if (mode === 'board') return ['read-filter', 'read-as-is', 'stop'];   // a board waits for the person's own Read; no other tab gets these two
  return mode === 'fill' ? ['apply-here', 'stop'] : ['stop'];
}
