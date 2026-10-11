// Waits until a page has been still for a moment, instead of a fixed second (apply-latency change 5, owner 11 Oct 2026): the fill reads a page once its DOM
// has not changed for `quietMs` (0.5 s), and never waits longer than the fixed wait it replaces (`maxMs`). A page that cannot be watched (still swapping
// documents, no access) waits the full `maxMs`, as before. Used by fill-flow.js consider/formAfterPress and account-step.js (before and after the account button); guarded by desktop/test/extension-page-still.test.js.

// Runs IN the page: resolves {still, ms} when no node or attribute changed for quietMs, or at maxMs (still: false). afterChange: the quiet time counts only
// once the page has changed (after a press: a page still quiet may be waiting on the site, so only a change and then stillness ends the wait early).
export function stillInPage(quietMs, maxMs, afterChange = false) {
  return new Promise(resolve => {
    const began = Date.now();
    let quiet = null, done = false;
    const finish = still => { if (done) return; done = true; clearTimeout(quiet); clearTimeout(cap); observer?.disconnect(); resolve({still, ms: Date.now() - began}); };
    const rearm = () => { clearTimeout(quiet); quiet = setTimeout(() => finish(true), quietMs); };
    const cap = setTimeout(() => finish(false), maxMs);
    const root = document.documentElement;
    const observer = root ? new MutationObserver(rearm) : null;
    observer?.observe(root, {childList: true, subtree: true, attributes: true, characterData: true});
    if (!afterChange) rearm();
  });
}

// -> {still, ms}. run: chrome.scripting.executeScript (injected for the test).
export async function pageStill(tabId, {quietMs = 500, maxMs = 1500, afterChange = false} = {}, run = options => chrome.scripting.executeScript(options)) {
  try {
    const [first] = await run({target: {tabId}, func: stillInPage, args: [Math.min(quietMs, maxMs), maxMs, afterChange]});
    if (first?.result) return first.result;
  } catch { /* not readable right now: wait as before */ }
  await new Promise(resolve => setTimeout(resolve, maxMs));
  return {still: false, ms: maxMs};
}
