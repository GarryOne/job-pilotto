// A tab's identity: which application it is (spec: docs/superpowers/specs/2026-10-10-application-journey.md, step 2). Every report to the app carries it,
// the app resolves the session one way (desktop/lib/journey-identity.js) and answers the id it used, which bindSession keeps on the tab.
// Reads only here: `session:<tab>` (the application), `job:<tab>` / `from:<tab>` (the posting the tab was opened for). Guard: desktop/test/extension-tab-identity.test.js.
// Invariant: the job of a tab is its posting, never the page it is on now (a sign-in page carries the posting that led to it).
import {sessionGet} from './tab-memory.js';
import {pageKey} from './tab-pages.js';

export async function jobOf(tab) {
  const stored = await sessionGet([`from:${tab.id}`, `job:${tab.id}`]);
  return stored[`job:${tab.id}`] || stored[`from:${tab.id}`] || pageKey(tab.url);
}

// -> {session, job, url}: what the app needs to know which application a report is about.
export async function identityOf(tab) {
  const session = (await sessionGet(`session:${tab.id}`))[`session:${tab.id}`] || '';
  return {session, job: String(await jobOf(tab)).split('#')[0], url: String(tab.url || '').split('#')[0]};
}

// The app answered which session it resolved: kept on the tab, so the next report carries it.
export async function bindSession(tabId, answered, carried = '') {
  if (!answered || answered === carried) return false;
  await chrome.storage.session.set({[`session:${tabId}`]: answered}).catch(() => {});
  return true;
}
