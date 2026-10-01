// The last known session list, so the Applying page paints it at once instead of a spinner — or, before this, the
// empty two-pane shell it used to show for seconds while the app answered (1 Oct 2026). Only the list payload the
// app itself sends (ids, titles, companies, states): never terminal output or a form answer.
// Kept free of the DOM so the decision can be tested (like review-pending.js): the storage is passed in.
const KEY = 'jp-sessions';

function readCache(storage) {
  try { return JSON.parse(storage.getItem(KEY) || 'null'); } catch { return null; }
}
export function rememberedSessions(storage = globalThis.localStorage) {
  const kept = readCache(storage);
  return Array.isArray(kept?.sessions) ? kept.sessions : [];
}
// True once this window has been given a list, including an empty one. Missing or unreadable is "never read".
export function hasSessionCache(storage = globalThis.localStorage) {
  return Array.isArray(readCache(storage)?.sessions);
}

export function rememberSessions(sessions, storage = globalThis.localStorage, at = new Date()) {
  try { storage.setItem(KEY, JSON.stringify({at: at.toISOString(), sessions})); } catch { /* no storage: just no cache */ }
}

// Which block the Applying page shows. The spinner means nothing has been read yet. A remembered list is already
// an answer, including one that is empty because every session was submitted: that is "no open sessions", not
// "still loading" (1 Oct 2026: the page sat on the spinner after the only session was filtered out).
export function sessionPanels({loaded = false, count = 0, fromCache = false} = {}) {
  const none = count === 0;
  const loading = !loaded && none && !fromCache;
  return {loading, empty: !loading && none, grid: count > 0, refreshing: fromCache && !loaded};
}
