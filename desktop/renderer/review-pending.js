// Interviews being reviewed elsewhere (Always on: GitHub runs the review; the app's call returns at once): remembered
// until the review lands on the Notion row (it has an outcome) or 20 minutes pass, across view reloads.
const KEY = 'ivReviewing', LIMIT_MS = 20 * 60 * 1000;

export function load(storage = globalThis.localStorage) {
  try { return JSON.parse(storage.getItem(KEY) || '{}'); } catch { return {}; }
}
function save(pending, storage = globalThis.localStorage) {
  try { storage.setItem(KEY, JSON.stringify(pending)); } catch {}
}
export function add(pageId, now = Date.now(), storage) { const p = load(storage); p[pageId] = now; save(p, storage); }
export function remove(pageId, storage) { const p = load(storage); delete p[pageId]; save(p, storage); }

// The rows from Notion settle it: reviewed (an outcome) or too old → no longer pending. Returns the pending ids.
export function settle(rows, now = Date.now(), storage) {
  const pending = load(storage), byId = new Map(rows.map(row => [row.id, row]));
  for (const [id, since] of Object.entries(pending)) {
    if (byId.get(id)?.overall || now - since > LIMIT_MS) delete pending[id];
  }
  save(pending, storage);
  return new Set(Object.keys(pending));
}
