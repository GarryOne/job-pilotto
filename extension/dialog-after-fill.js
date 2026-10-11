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

// The gate before the fill (owner, 11 Oct 2026: "we should not start filling any form before we close all the popups/overlays"). look(tabId) -> what covers the form's controls
// (on-top.js: {text, buttons, ...}) or null; close(tabId) -> the label of the AI's non-agreeing button pressed, or ''. A layer is closed and looked at again, at most 3 times;
// one nothing closes (the AI says none: a sign-in, a robot check, a consent the person must give) holds the fill, and nothing is typed. -> {held, closed: [labels], layer}
export const HELD = 'a dialog covers the form';
export async function clearBeforeFill(tabId, {close, look, tries = 3, settleMs = 600}) {
  const closed = [];
  for (let attempt = 0; attempt < tries; attempt++) {
    const layer = await look(tabId).catch(() => null);
    if (!layer) return {held: false, closed, layer: null};
    const pressed = await close(tabId).catch(() => '');
    if (!pressed) return {held: true, closed, layer};
    closed.push(pressed);
    await sleep(settleMs);
  }
  const layer = await look(tabId).catch(() => null);
  return {held: !!layer, closed, layer: layer || null};
}

// A held fill, said everywhere: the log line the pool reads (smoke.mjs parseLive), and the person told on the page.
export async function holdFill(tab, page, result, {decide, progress, note}) {
  const why = String(result.layer?.text || '').slice(0, 120);
  decide('fill', `held: ${result.note}`, {host: (() => { try { return new URL(tab.url).hostname; } catch { return ''; } })(), text: why, buttons: result.layer?.buttons?.length || 0});
  await progress(tab.id, '', page);
  await note(tab.id, `✈️ A dialog is in the way${why ? `: "${why}"` : ''}. Close it, then press Fill again.`, page);
  return result;
}
