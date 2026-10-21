// A captcha met in the refused-site real tab stays in its hidden incognito window instead of being thrown away (owner, 21 Oct 2026: "can't they stay hidden, and to be informed only
// when there is a captcha? Only then with a button, deliberately to focus the window"). The window is never focused by us: only the person's press of "Show the check" in the app brings it
// forward. Nothing here clicks, types or solves; once the person solved it and the AI says the page is now `page`, the page is read like any other. At most one is held, for HOLD_MS.
// Kept in chrome.storage.local so a restarted service worker still knows it. Guard: desktop/test/extension-refused-held.test.js.
export const HOLD_MS = 10 * 60 * 1000;
const KEY = 'refusedHeld';

const read = async chrome => (await chrome.storage.local.get(KEY))[KEY] || null;
const clear = async chrome => chrome.storage.local.remove(KEY);

export async function hold({chrome, winId, tabId, url, now = Date.now}) {
  const before = await read(chrome);
  if (before) await chrome.windows.remove(before.winId).catch(() => {});   // one at a time: an older check is let go
  await chrome.storage.local.set({[KEY]: {winId, tabId, url, at: now()}});
}

export const heldUrl = async chrome => (await read(chrome))?.url || null;

// The person pressed "Show the check": the one deliberate focus of this window.
export async function show(chrome) {
  const held = await read(chrome);
  if (!held) return false;
  const shown = await chrome.windows.update(held.winId, {state: 'normal', focused: true}).catch(() => null);
  if (!shown) { await clear(chrome); return false; }
  await chrome.storage.local.set({[KEY]: {...held, shown: true}});   // only a check the person was shown can have been solved: no looking (and no AI call) before
  return true;
}

// One look (every minute, from the extension's Read now alarm): the page once the person solved it, null while it still waits; the window closes when it is read, gone, or too old.
export async function look({chrome, judge, now = Date.now}) {
  const held = await read(chrome);
  if (!held) return null;
  const close = async () => { await chrome.windows.remove(held.winId).catch(() => {}); await clear(chrome); };
  if (now() - held.at > HOLD_MS) { await close(); return null; }
  if (!held.shown) return null;
  const seen = await chrome.scripting.executeScript({target: {tabId: held.tabId}, func: () => ({html: document.documentElement.outerHTML, title: document.title, final: location.href})}).then(result => result?.[0]?.result || null).catch(() => null);
  if (!seen) { await close(); return null; }   // the window or tab is gone (the person closed it)
  const page = {url: held.url, status: 200, html: String(seen.html || '').slice(0, 3_000_000), title: seen.title || '', final: seen.final || held.url};
  if ((await judge(page).catch(() => null))?.state !== 'page') return null;
  await close();
  return page;
}
