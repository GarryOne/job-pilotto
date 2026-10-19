// What the form panel's "Tailor CV + letter" press did, per job page, so the panel can say it (started, done, not in your list, failed) instead of the app toasting in its own window.
// Read by the review poll (main.js cvOf → the panel); written by the tailor handler (cv-handlers.js). Guard: desktop/test/tailor-status.test.js.
import {isFormOf} from './apply.js';

const pageKey = url => String(url || '').split('#')[0].replace(/\/+$/, '');
const entries = new Map();   // page key → {state, ...}; a job is reached by its posting address, the form's address or the tab's

// state: 'running' | 'done' | 'failed' | 'not-listed' | 'adding' | 'added'
export function setStatus(urls, status) {
  for (const url of urls) { const key = pageKey(url); if (key) entries.set(key, {...status, at: Date.now()}); }
}
export function statusOf(url) {
  const key = pageKey(url);
  if (!key) return null;
  if (entries.has(key)) return entries.get(key);
  for (const [other, status] of entries) if (isFormOf(key, other) || isFormOf(other, key)) return status;
  return null;
}
export const isRunning = urls => urls.some(url => statusOf(url)?.state === 'running');
export const forgetAll = () => entries.clear();   // tests
