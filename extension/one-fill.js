// One fill per tab at a time: a second ask to fill a tab that is filling joins the running fill and gets its result (Windows beta, 17 Oct 2026: two reads of the sign-up's next page started two fills 0.2 s apart; the first one's card-id write landed after the second's "done" and wiped it). Guard: worker/test/one-fill.test.js.
const running = new Map();   // tabId -> the promise of the fill running on it

export function oneFillPerTab(tabId, start, {onJoin = () => {}} = {}) {
  const live = running.get(tabId);
  if (live) { onJoin(); return live; }
  const fill = Promise.resolve().then(start).finally(() => { if (running.get(tabId) === fill) running.delete(tabId); });
  running.set(tabId, fill);
  return fill;
}
