// Which tabs belong to which application (docs/flows/applying.md, owner 8 Oct 2026): a tab opened by an application's tab is the same
// application (it inherits its job and session), and a tab the page opens by script right after the extension pressed Apply is followed
// while the posting tab closes (same-tab.js decides which). Scenarios owned: "Apply opens its form from the page's script", "Two
// applications side by side". Guards: extension-same-tab.test.js, review.test.js, the e2e rows "Apply opens a new tab" and "side by side".
import {FOLD_MS, postingToClose, realOpener} from './same-tab.js';
import {pageKey} from './tab-pages.js';
import {decide} from './log.js';
import {sessionGet} from './tab-memory.js';

export const navSources = new Map();   // new tab id → the tab whose page created it (webNavigation.onCreatedNavigationTarget)
export const noteSource = details => { navSources.set(details.tabId, details.sourceTabId); setTimeout(() => navSources.delete(details.tabId), 60000); };
// The opener of a just-created tab. The source event comes a moment after tabs.onCreated, so a tab that has an opener waits briefly for it.
export async function openerOf(tab, waitMs = 250) {
  if (tab.openerTabId == null && !navSources.has(tab.id)) return null;
  for (let waited = 0; waited < waitMs && !navSources.has(tab.id); waited += 25) await new Promise(resolve => setTimeout(resolve, 25));
  return realOpener(tab, navSources);
}
export const applyPressed = new Map();   // tab id → {at, url}: when and on which page the extension pressed its Apply button

// A tab opened by an armed tab (Apply in a new tab) is the same session. A tab the user opened is not.
// The mark the app puts on a tab it opens for a job (background.js FILL_MARK; a test keeps the two equal).
export const APP_TAB_MARK = 'jobpilotto-fill';
export async function followOpener(tab) {
  // A tab the app opened for a job carries its mark from the start (url or pendingUrl): it is that job's, never the tab that happened to be in front.
  // The from: key below is set a moment later, too late: on 9 Oct 2026 Nahrin's jobs.ch tab, opened while Coop's tab was in front, inherited Coop's
  // session and its first tab report bound it to Coop (found by mac-1a).
  if ([tab.url, tab.pendingUrl].some(address => String(address || '').includes(`#${APP_TAB_MARK}`))) return false;
  const opener = await openerOf(tab);
  if (opener == null) return false;
  if ((await sessionGet(`from:${tab.id}`))[`from:${tab.id}`]) return false;   // a tab the app opened for a job already has its own: the tab that was in front is not its parent (8 Oct 2026, side by side)
  const stored = await sessionGet([`armed:${opener}`, `from:${opener}`, `job:${opener}`, `session:${opener}`]);
  if (!stored[`armed:${opener}`]) return false;
  const next = {[`armed:${tab.id}`]: true};
  if (stored[`session:${opener}`]) next[`session:${tab.id}`] = stored[`session:${opener}`];   // the same application: the newest tab is its tab now
  if (stored[`from:${opener}`]) next[`from:${tab.id}`] = stored[`from:${opener}`];
  if (stored[`job:${opener}`]) next[`job:${tab.id}`] = stored[`job:${opener}`];
  await chrome.storage.session.set(next);
  return true;
}

// Apply opened its next page in a new tab by script (a link or form was already pointed at this tab): the new tab is the
// application from now on, and the posting's tab closes, so one tab is left to follow. A pop-up window (a sign-in) never closes it.
const postingHandled = new Set();   // new tab ids already looked at: each is handled once
export async function closePosting(tab, host) {
  if (postingHandled.has(tab.id)) return;
  postingHandled.add(tab.id);
  const openerId = await openerOf(tab);
  const opener = openerId == null ? null : await chrome.tabs.get(openerId).catch(() => null);
  // Strict: the new tab's opener is the very tab whose Apply was just pressed, still on that page (another flow's tab never is).
  const posting = postingToClose({...tab, openerTabId: openerId}, applyPressed, opener?.url, Date.now(), pageKey);
  if (posting == null) {
    const press = openerId == null ? null : applyPressed.get(openerId);   // why the posting stays: no opener, no press of its own, too long ago, or it is no longer on the page pressed
    decide('panel', 'Apply opened a new tab: the posting tab stays', {host, tab: tab.id, opener: openerId, chromeOpener: tab.openerTabId ?? null, openerUrl: String(opener?.url || '').split('?')[0].slice(0, 80), active: !!opener?.active, pressed: !!press, ageMs: press ? Date.now() - press.at : null, samePage: press ? pageKey(opener?.url) === pageKey(press.url) : null, pressedTabs: [...applyPressed.keys()].join(',')});
    return;
  }
  applyPressed.delete(posting);
  const win = await chrome.windows.get(tab.windowId).catch(() => null);
  if (win?.type !== 'normal') { decide('panel', 'Apply opened a pop-up: the posting tab stays', {host, opener: posting, tab: tab.id}); return; }
  await chrome.tabs.remove(posting).catch(() => {});
  decide('panel', 'Apply opened a new tab: followed it, closed the posting tab', {host, opener: openerId, closed: posting, tab: tab.id, within: FOLD_MS});
}
