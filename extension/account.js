// Account pages (sign-in, sign-up) kept apart from the application form (docs/flows/applying.md, owner 8 Oct 2026): each tab's page
// type by the one rule (tab-pages.js pageRole), and the check every learner and the submit judge ask before they use a page.
// Scenarios owned: "Sign-up page before the form", "Account and application on one page". Guards: extension-tab-pages.test.js,
// the e2e rows "sign-up page" and "one page" (npm run flows).
// Invariants (flow core: read before editing; changing one is the owner's call, said in the commit; each names the test that guards it):
//  1. An account page's fields never count as the application form's progress (desktop/test/extension-tab-pages.test.js, desktop/test/journeys.test.js).
import {isAccountPage, pageKey} from './tab-pages.js';
import {decide} from './log.js';
import {sessionGet} from './tab-memory.js';

// Each tab's page type (tab-pages.js pageRole: 'account' | 'form' | 'no-form'), for the page it was decided on. The one rule both
// flows go by: a sign-in or sign-up page feeds nothing on the application side (no learned answers, no fill misses, no "submitted").
export async function noteRole(tabId, url, role) { await chrome.storage.session.set({[`role:${tabId}`]: {role, page: pageKey(url)}}).catch(() => {}); }
export async function roleOf(tabId, url) {
  const stored = (await sessionGet(`role:${tabId}`).catch(() => ({})))[`role:${tabId}`];
  return stored && stored.page === pageKey(url) ? stored.role : '';
}
// A sign-in or sign-up page: the rule said so for this page, or the panel sees a password box on it now (a page that became one).
export async function onAccountPage(tab, panelSaw = false, url = '') {
  const stored = (await sessionGet(`role:${tab.id}`).catch(() => ({})))[`role:${tab.id}`];
  return isAccountPage(stored, pageKey(url || tab.url), panelSaw, pageKey);
}
export const accountSkip = (tab, what) => { let host = ''; try { host = new URL(tab.url).hostname; } catch { /* no address */ } decide('panel', `account page: ${what}`, {host}); };

