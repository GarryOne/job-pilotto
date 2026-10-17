// The one way the app gets this install's site token for a purpose ('ai', 'report', 'recipes', 'index'): asked once and kept (an install's token never
// changes), one ask at a time, and after a refusal (the site's per-address daily limit, 429) not asked again before the next UTC day.
// 17-18 Oct 2026: the app asked again on every call and retried at once; ~1 ask a second from this Mac used up the day's 20 'ai' tokens and the
// owner's Ready to send card stayed hidden. Callers: ai-free.js, ready-site.js, plan.js, report-upload.js, recipes.js. Guard: test/install-token.test.js.
const KEPT = 'siteTokens', WAIT = 'siteTokenWait';
const LEGACY = {report: 'reportToken', recipes: 'recipesToken'};   // where these two were kept before: read once, so no install asks again
const asking = new Map();

const nextUtcDay = at => { const day = new Date(at); return Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + 1); };

// -> the kept token for this install and purpose, or ''.
export function keptToken(storage, install, purpose) {
  const settings = storage.settings();
  const kept = settings[KEPT]?.[purpose] || settings[LEGACY[purpose]];
  return kept?.install === install && kept.value ? kept.value : '';
}

// A kept token the site refused (401: a token from before a key change): dropped, so the next call asks for a new one once.
export function forgetToken(storage, purpose) {
  const {[purpose]: _gone, ...rest} = storage.settings()[KEPT] || {};
  storage.saveSettings({[KEPT]: rest, ...(LEGACY[purpose] ? {[LEGACY[purpose]]: null} : {})});
}

// base: the site's origin. -> the token, or '' (refused, offline, or waiting for tomorrow after a refusal). Never throws.
export async function installToken(storage, install, purpose, {base, fetcher = globalThis.fetch, now = Date.now} = {}) {
  const kept = keptToken(storage, install, purpose);
  if (kept) return kept;
  if ((storage.settings()[WAIT]?.[purpose] || 0) > now()) return '';
  const key = `${install}:${purpose}`;
  if (!asking.has(key)) asking.set(key, (async () => {
    try {
      const response = await fetcher(`${base}/api/install-token`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(purpose === 'recipes' ? {install} : {install, purpose})});
      const body = await response.json().catch(() => ({}));
      if (response.ok && body.token) {
        storage.saveSettings({[KEPT]: {...storage.settings()[KEPT], [purpose]: {install, value: String(body.token)}}});
        return String(body.token);
      }
      if (response.status === 429) storage.saveSettings({[WAIT]: {...storage.settings()[WAIT], [purpose]: nextUtcDay(now())}});
      return '';
    } catch { return ''; }   // offline: the next call asks again
    finally { asking.delete(key); }
  })());
  return asking.get(key);
}
