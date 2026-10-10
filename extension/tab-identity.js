// A tab's identity: which application it is (spec: docs/superpowers/specs/2026-10-10-application-journey.md, step 2). Every report to the app carries it,
// the app resolves the session one way (desktop/lib/journey-identity.js) and answers the id it used, which bindSession keeps on the tab.
// The keys `session:<tab>` (the application), `job:<tab>` / `from:<tab>` (the posting the tab was opened for) are named only here (KEY); every other file
// uses KEY or the helpers below. Guard: desktop/test/extension-tab-identity.test.js (it fails when another file builds one of these names).
// Invariant: the job of a tab is its posting, never the page it is on now (a sign-in page carries the posting that led to it).
import {sessionGet} from './tab-memory.js';
import {pageKey} from './tab-pages.js';

export const KEY = {session: tabId => `session:${tabId}`, job: tabId => `job:${tabId}`, from: tabId => `from:${tabId}`};
export const IDENTITY_KEYS = tabId => [KEY.from(tabId), KEY.job(tabId), KEY.session(tabId)];

export async function jobOf(tab) {
  const stored = await sessionGet([KEY.from(tab.id), KEY.job(tab.id)]);
  return stored[KEY.job(tab.id)] || stored[KEY.from(tab.id)] || pageKey(tab.url);
}
export const sessionOf = async tabId => (tabId == null ? '' : (await sessionGet(KEY.session(tabId)))[KEY.session(tabId)] || '');
export const fromOf = async tabId => (await sessionGet(KEY.from(tabId)))[KEY.from(tabId)];
// A page the app opened starts its own job: the session and job a tab that happened to open it handed over are dropped (background.js).
export async function startJob(tabId, posting) {
  await chrome.storage.session.remove([KEY.job(tabId), KEY.session(tabId)]);
  await chrome.storage.session.set({[KEY.from(tabId)]: posting});
}
// What a tab opened by an application's tab inherits from it (tabs.js followOpener): its entries to set on the new tab, from the opener's stored values.
export function inheritedEntries(stored, opener, tabId) {
  const next = {};
  for (const name of ['session', 'from', 'job']) if (stored[KEY[name](opener)]) next[KEY[name](tabId)] = stored[KEY[name](opener)];
  return next;
}

// -> {session, job, url}: what the app needs to know which application a report is about.
export async function identityOf(tab) {
  const session = await sessionOf(tab.id);
  return {session, job: String(await jobOf(tab)).split('#')[0], url: String(tab.url || '').split('#')[0]};
}

// The app answered which session it resolved: kept on the tab, so the next report carries it.
export async function bindSession(tabId, answered, carried = '') {
  if (!answered || answered === carried) return false;
  await chrome.storage.session.set({[KEY.session(tabId)]: answered}).catch(() => {});
  return true;
}
