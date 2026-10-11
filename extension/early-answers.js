// The form's questions asked early (apply-latency D, owner 11 Oct 2026): a page that already shows a form has its open questions sent to the AI beside
// the page-kind ask (fill-flow.js consider -> flow.js askEarly), so when the page is judged a form the answers are often there already instead of
// asked after (the form page cost a page-kind ask THEN an answers ask, ~5 s + ~4.5 s). The fill takes the early answer only for the same tab, page and
// exactly the same open questions, within FRESH_MS, once; otherwise it asks as before. An answer nobody takes is dropped (it writes nothing).
// Guard: desktop/test/early-answers.test.js.
const FRESH_MS = 60000;
const pending = new Map();   // `${tabId} ${page}` -> {at, fields, answer: Promise}
const keyOf = (tabId, url) => `${tabId} ${String(url || '').split('#')[0]}`;
const fieldsOf = open => JSON.stringify((open || []).map(item => item.field).sort());

export function keepEarly(tabId, url, open, answer, now = Date.now()) {
  pending.set(keyOf(tabId, url), {at: now, fields: fieldsOf(open), answer: Promise.resolve(answer).catch(() => null)});
}
// -> the early answer's Promise (null when it failed: then ask again), or null when there is none for these questions.
export function takeEarly(tabId, url, open, now = Date.now()) {
  const key = keyOf(tabId, url), item = pending.get(key);
  pending.delete(key);
  return item && now - item.at < FRESH_MS && item.fields === fieldsOf(open) ? item.answer : null;
}
export const hasEarly = (tabId, url, now = Date.now()) => { const item = pending.get(keyOf(tabId, url)); return !!item && now - item.at < FRESH_MS; };
