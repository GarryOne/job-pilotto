// After a fill: a dialog that opened while the form was filled (often our own upload or typing: a site's "your fields may be replaced, continue?") is closed
// with the button the app's AI names for "close without agreeing" (consent.js closePopup, popup-pick.js), and one still over the form after that is reported,
// so a run never ends "5 of 8 filled" with a modal covering the form (Louis Vuitton jobs, 11 Oct 2026). Found by structure (popup-page.js), no words here.
// Guards: worker/test/dialog-after-fill.test.js.
export const LEFT_OPEN = 'a dialog was left open over the form';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// close(tabId) -> label pressed or ''; look(tabId) -> {text, buttons} of a dialog still in the way, or null. -> {closed, left}
export async function settleDialogs(tabId, {close, look, settleMs = 600}) {
  const closed = await close(tabId).catch(() => '');
  if (closed) await sleep(settleMs);
  const left = await look(tabId).catch(() => null);
  return {closed: closed || '', left: left?.buttons?.length ? {text: String(left.text || '').slice(0, 200), buttons: left.buttons.slice(0, 6)} : null};
}
// The fill's own end: close what opened, say what is still there (a log line the smoke reads: desktop/e2e/lib/smoke.mjs parseLive).
export async function closeFillDialogs(tab, {close, look, decide}) {
  const dialogs = await settleDialogs(tab.id, {close, look});
  if (dialogs.closed) decide('fill', 'closed a dialog opened by the fill', {label: dialogs.closed.slice(0, 40)});
  if (dialogs.left) decide('fill', LEFT_OPEN, {host: (() => { try { return new URL(tab.url).hostname; } catch { return ''; } })(), buttons: dialogs.left.buttons.length});
  return dialogs;
}
