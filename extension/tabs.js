// Which tabs belong to which application (docs/flows/applying.md, owner 8 Oct 2026): a tab opened by an application's tab is the same
// application (it inherits its job and session), and a tab the page opens by script right after the extension pressed Apply is followed
// while the posting tab closes (same-tab.js decides which). Scenarios owned: "Apply opens its form from the page's script", "Two
// applications side by side". Guards: extension-same-tab.test.js, review.test.js, the e2e rows "Apply opens a new tab" and "side by side".
import {FOLD_MS, postingToClose} from './same-tab.js';
import {pageKey} from './tab-pages.js';
import {decide} from './log.js';
import {sessionGet} from './tab-memory.js';

export const applyPressed = new Map();   // tab id → {at, url}: when and on which page the extension pressed its Apply button

// A tab opened by an armed tab (Apply in a new tab) is the same session. A tab the user opened is not.
export async function followOpener(tab) {
  if (tab.openerTabId == null) return false;
  const opener = tab.openerTabId;
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
  const opener = tab.openerTabId == null ? null : await chrome.tabs.get(tab.openerTabId).catch(() => null);
  // Strict: the new tab's opener is the very tab whose Apply was just pressed, still on that page (another flow's tab never is).
  const posting = postingToClose(tab, applyPressed, opener?.url, Date.now(), pageKey);
  if (posting == null) return;
  applyPressed.delete(posting);
  const win = await chrome.windows.get(tab.windowId).catch(() => null);
  if (win?.type !== 'normal') { decide('panel', 'Apply opened a pop-up: the posting tab stays', {host, opener: posting, tab: tab.id}); return; }
  await chrome.tabs.remove(posting).catch(() => {});
  decide('panel', 'Apply opened a new tab: followed it, closed the posting tab', {host, opener: tab.openerTabId, closed: posting, tab: tab.id, within: FOLD_MS});
}
