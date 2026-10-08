// The extension's memory of its tabs (which session and job each tab is, which the app opened, the sites being read) lives in
// chrome.storage.session, which Chrome empties on every reload of the extension (an update, ↻ by hand) although the tabs and
// their ids live on. A live copy is kept in local storage, tagged with the browser run, and put back when the extension starts
// again in the same run. Only a Chrome start begins a new run: tab ids start again then, so the copy would point at other tabs.
// (8 Oct 2026: an update emptied it seconds after a fill; the app said "Form closed" for the open form and lost it for good.)
export const MEMORY_KEY = 'tabMemory';
const tabOfKey = key => { const match = /^[a-z-]+:(\d+)$/i.exec(key); return match ? Number(match[1]) : null; };
const place = url => { try { return new URL(url).host || String(url || ''); } catch { return String(url || ''); } };

// The copy to keep: the items, and where each tab they name was (its host), to recognise those tabs after a reload.
export function snapshot(items, tabs, now = Date.now()) {
  const named = new Set(Object.keys(items || {}).map(tabOfKey).filter(id => id !== null));
  const where = Object.fromEntries((tabs || []).filter(tab => named.has(tab.id)).map(tab => [tab.id, place(tab.url)]));
  return {boot: String(items?.boot || ''), at: now, tabs: where, items: items || {}};
}

// A worker starting with empty session storage: the same browser run (the extension reloaded) or a new one (Chrome started)?
// → {boot: the run's id to keep, or '' for a new one; restore: the items to put back, or null; why}
export function startRun({kept, sawStartup = false, tabsNow = []} = {}) {
  if (sawStartup) return {boot: '', restore: null, why: 'Chrome started'};
  if (!kept?.boot || !kept.items || typeof kept.items !== 'object') return {boot: '', restore: null, why: 'nothing kept'};
  const was = Object.entries(kept.tabs || {});
  const now = new Map((tabsNow || []).map(tab => [tab.id, place(tab.url)]));
  // Tabs it knew, none still there at the same id and site: Chrome restarted without telling (or they were all closed): a new run.
  if (was.length && !was.some(([id, host]) => now.get(Number(id)) === host)) return {boot: '', restore: null, why: 'its tabs are gone'};
  return {boot: kept.boot, restore: kept.items, why: 'extension reloaded'};
}
