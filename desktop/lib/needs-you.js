// Telegram, notification and toast for "Claude needs your input" (main.js sessionNeedsYou): once per question. A session
// that asks the same thing again (the reply "Continue." changes nothing) must not ping again every few minutes
// (1 Oct 2026: a 4-hour loop of Telegram messages). A different question, or the same one after a quiet hour, does.
export const QUIET_MS = 60 * 60 * 1000;
export function shouldNotify(seen, id, text, now = Date.now()) {
  const last = seen.get(id);
  const key = String(text || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
  if (last && now - last.at < QUIET_MS && (last.key === key || now - last.at < 15 * 60 * 1000)) return false;
  seen.set(id, {key, at: now});
  return true;
}
