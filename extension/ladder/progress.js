// The run's progress (spec docs/superpowers/specs/2026-10-12-one-next-move.md, phase 2 box 2: the silent dead-end rule). ONE call per observable sign that an application moved,
// fixed kinds only, logged in shadow as "progress: <kind>", so the gaps between them are measured on the CI pool and the rule's T comes from data. No detector here yet: nothing in
// this file changes what happens. Kinds: navigated (a new page in the tab), new_controls (fields or a frame appeared on a page judged without a form), required_down (a fill put a
// value in a required field), value_stayed (RESERVED for the fill ladder's attempt log, extension/page/attempts.js: its page script sends {type: 'progress', kind: 'value_stayed'};
// this file never detects a value itself, cc 12 Oct 2026). Guard: worker/test/progress.test.js.
import {evidenceOf} from './dead-end.js';

export const PROGRESS_KINDS = ['navigated', 'new_controls', 'required_down', 'value_stayed'];
export const PAGE_KINDS = ['value_stayed'];   // the only kinds a page script may send
let log = () => {};
export const useProgressLog = fn => { log = fn; };
const last = new Map();   // tabId -> {at, kind}
const pages = new Map();   // tabId -> the page key last considered

// noteProgress(tabId, kind, data) -> true when noted. data: fixed values of ours (evidenceOf), never page text.
export function noteProgress(tabId, kind, data = {}, now = Date.now()) {
  if (tabId == null || !PROGRESS_KINDS.includes(kind)) return false;
  const before = last.get(tabId);
  last.set(tabId, {at: now, kind});
  log('fill', `progress: ${kind}`, {...evidenceOf(data), ...(before ? {sinceMs: now - before.at} : {})});
  return true;
}
// A page the fill flow considers: a new page key for the tab is 'navigated'; the same page looked at again is not.
export function notePage(tabId, key, data = {}, now = Date.now()) {
  if (pages.get(tabId) === key) return false;
  pages.set(tabId, key);
  return noteProgress(tabId, 'navigated', data, now);
}
export const lastProgress = tabId => last.get(tabId) || null;
export const forgetProgress = tabId => { last.delete(tabId); pages.delete(tabId); };

// A page script's report (only PAGE_KINDS), and a closed tab forgotten. Registered here, at the worker's start; another message is left to the other handlers (no reply).
globalThis.chrome?.runtime?.onMessage?.addListener((message, sender) => {
  if (message?.type === 'progress' && sender?.tab?.id != null && PAGE_KINDS.includes(message.kind)) noteProgress(sender.tab.id, message.kind, {});
});
globalThis.chrome?.tabs?.onRemoved?.addListener(forgetProgress);
