/* global document, location */
// The ladder's "real tab" step for a site that refused the engine and the Chrome download (owner, 20 Oct 2026: "step 2, real tab"): a background tab in ONE minimized
// INCOGNITO window of the person's own Chrome, so no cookie or login of theirs is ever sent (the incognito jar starts empty; what a check sets is dropped on close).
// It waits up to WAIT_MS for a passive "checking your browser" page to clear BY ITSELF: no click, no typing, no solving, ever. The app's AI says what the page is now
// (/extension/refused-judge: page | passive_check | captcha | login | refused); only `page` is read, a captcha is a stop for the app to offer to the person.
// Runs only when Chrome lets the extension into incognito (Allow in Incognito, once) and the window REPORTS it is incognito; otherwise nothing is opened.
// At most DAILY_TABS sites a day, never focused. Not a flow file: nothing here touches an application. Guard: desktop/test/extension-refused-tab.test.js.
import {moveTab} from './tabs.js';
import {hold} from './refused-held.js';
export const DAILY_TABS = 5;
export const WAIT_MS = 15000;
export const POLL_MS = 3000;
const KEY = 'refusedTabs';
const today = now => new Date(now()).toISOString().slice(0, 10);
const wait = ms => new Promise(done => setTimeout(done, ms));

// One tab reader per pass: `read(url)` -> {skipped: why} | {state, page: {url, status, html, title, final}}; `close()` ends the window.
export function tabReader({chrome = globalThis.chrome, judge, now = Date.now, sleep = wait, waitMs = WAIT_MS, pollMs = POLL_MS} = {}) {
  let win = null;
  const budget = async () => {
    const kept = (await chrome.storage.local.get(KEY))[KEY] || {};
    return kept.day === today(now) ? kept.n || 0 : 0;
  };
  const spend = async n => chrome.storage.local.set({[KEY]: {day: today(now), n}});
  const allowedInIncognito = () => new Promise(resolve => { try { chrome.extension.isAllowedIncognitoAccess(answer => resolve(!!answer)); } catch { resolve(false); } });

  async function window_() {
    if (win) return win;
    const made = await chrome.windows.create({url: 'about:blank', incognito: true, state: 'minimized', focused: false}).catch(() => null);
    const tab = made?.tabs?.[0];
    if (!made || made.incognito !== true || !tab || tab.incognito !== true) {   // the guard: not provably incognito, nothing is loaded
      if (made?.id !== undefined) await chrome.windows.remove(made.id).catch(() => {});
      return null;
    }
    return win = {id: made.id, tabId: tab.id};
  }

  async function snapshot(tabId) {
    const [result] = await chrome.scripting.executeScript({target: {tabId}, func: () => ({html: document.documentElement.outerHTML, title: document.title, final: location.href})});
    return result?.result || null;
  }

  async function read(url) {
    if (!(await allowedInIncognito())) return {skipped: 'incognito'};
    const used = await budget();
    if (used >= DAILY_TABS) return {skipped: 'budget'};
    const open = await window_();
    if (!open) return {skipped: 'no incognito window'};
    await spend(used + 1);
    await moveTab(open.tabId, url, chrome);   // the window is minimized and unfocused, so the tab is never brought forward
    const deadline = now() + waitMs;
    let state = 'passive_check', page = null;
    while (now() < deadline) {
      await sleep(pollMs);
      const seen = await snapshot(open.tabId).catch(() => null);
      if (!seen) break;
      page = {url, status: 200, html: String(seen.html || '').slice(0, 3_000_000), title: seen.title || '', final: seen.final || url};
      state = (await judge(page).catch(() => null))?.state || 'refused';
      if (state !== 'passive_check') break;   // waiting is only for a check that clears by itself
    }
    if (state === 'captcha') {   // words-ok: the app AI's fixed page_state answer, not a page's words; the check stays in its hidden window for the person to open from the app (refused-held.js); the next site gets a window of its own
      await hold({chrome, winId: open.id, tabId: open.tabId, url, now});
      win = null;
      return {state, page, held: true};
    }
    await moveTab(open.tabId, 'about:blank', chrome).catch(() => {});   // the site's page is gone before the next one
    return {state, page};
  }

  const close = async () => { if (win) { await chrome.windows.remove(win.id).catch(() => {}); win = null; } };
  return {read, close};
}
