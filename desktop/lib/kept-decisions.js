// Decisions the AI made once and the app keeps (spec: docs/superpowers/specs/2026-10-10-application-journey.md, step 5): every kept answer carries when it was
// made, is asked again once it is older than MAX_AGE_MS, and is dropped at once when the page contradicts it (forget). 10 Oct 2026: a cookie banner's
// "Cookie notice" LINK was kept as its close button and opened a tab per visit, with nothing that could ever undo it.
// Users: lib/popup-pick.js, lib/option-pick.js. Guard: test/kept-decisions.test.js.
// Invariants: 1. an answer without a time (kept before 10 Oct 2026) counts as expired; 2. forget removes exactly one key; 3. nothing here asks the AI.
export const MAX_AGE_MS = 30 * 24 * 3600 * 1000;

export function readKept(storage, file) {
  try { return JSON.parse(storage.readText(file) || '{}') || {}; } catch { return {}; }
}
// -> {found, value}: found only for an answer younger than maxAge.
export function keptValue(kept, key, {now = Date.now(), maxAge = MAX_AGE_MS} = {}) {
  const entry = kept?.[key];
  if (!entry || typeof entry !== 'object' || typeof entry.at !== 'number' || now - entry.at > maxAge) return {found: false, value: ''};
  return {found: true, value: String(entry.v ?? '')};
}
export function keep(storage, file, kept, key, value, now = Date.now()) {
  kept[key] = {v: value, at: now};
  storage.writeText(file, JSON.stringify(kept));
}
export function forget(storage, file, key) {
  const kept = readKept(storage, file);
  if (!(key in kept)) return false;
  delete kept[key];
  storage.writeText(file, JSON.stringify(kept));
  return true;
}
