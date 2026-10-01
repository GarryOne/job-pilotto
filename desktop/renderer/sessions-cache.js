// The last known session list, so the Applying page paints it at once instead of a spinner — or, before this, the
// empty two-pane shell it used to show for seconds while the app answered (1 Oct 2026). Only the list payload the
// app itself sends (ids, titles, companies, states): never terminal output or a form answer.
// Kept free of the DOM so the decision can be tested (like review-pending.js): the storage is passed in.
const KEY = 'jp-sessions';

export function rememberedSessions(storage = globalThis.localStorage) {
  try {
    const kept = JSON.parse(storage.getItem(KEY) || 'null');
    return Array.isArray(kept?.sessions) ? kept.sessions : [];
  } catch {
    return [];
  }
}

export function rememberSessions(sessions, storage = globalThis.localStorage, at = new Date()) {
  try { storage.setItem(KEY, JSON.stringify({at: at.toISOString(), sessions})); } catch { /* no storage: just no cache */ }
}
