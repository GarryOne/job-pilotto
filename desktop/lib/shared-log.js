// What the app sent to the Job Pilotto service, kept on this Mac so "See what's sent" shows it: the last 20 requests, exactly as they left
// (the batched counts, the fingerprints of a form's controls, the label-meanings request, a fill report). Settings → Advanced reads it.
// Nothing here is sent anywhere; it is only a copy of what already was.
const FILE = 'data/shared-log.json', KEEP = 20, MAX_CHARS = 8000;

export function add(storage, what, sent, now = Date.now()) {
  try {
    let text = JSON.stringify(sent ?? {});
    if (text.length > MAX_CHARS) text = JSON.stringify({truncated: true, start: text.slice(0, MAX_CHARS)});
    storage.writeText(FILE, JSON.stringify([{at: new Date(now).toISOString(), what: String(what).slice(0, 80), sent: JSON.parse(text)}, ...list(storage)].slice(0, KEEP)));
  } catch { /* a log must never break a send */ }
}

export function list(storage) {
  try { const items = JSON.parse(storage.readText(FILE) || '[]'); return Array.isArray(items) ? items : []; } catch { return []; }
}
