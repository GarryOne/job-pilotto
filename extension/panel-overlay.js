// The fill overlay (owner, 19 Oct 2026): while the extension fills, the page is dimmed and the person's clicks, keys and scrolling are held back, so nothing is disturbed mid-fill.
// The layer takes NO hit-test (pointer-events: none): every page read (elementFromPoint, on-top.js) and the driver's own clicks see the page; the blocking is done by capturing listeners
// that drop only the person's trusted input. The driver (extension/input-gap.js) sets data-jobpilotto-driving around its own debugger input, which lets that through. The panel, the Stop chip
// and the report card (ids starting jobpilotto) are never held. It lifts on every end: review.js calls off() when the fill ends, is stopped, needs the person or is stuck; a page change drops
// it with the document; an extension reload and a missing refresh lift it from here. Injected before review.js (panel-files.js). Guards: desktop/e2e/test/fill-overlay.test.mjs, desktop/test/fill-overlay.test.js.
(() => {
  const ID = 'jobpilotto-fill-overlay', MAX_MS = 180000;   // MAX_MS: no step refreshed it for three minutes: the person is never locked out of a stuck page
  const HELD = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'keydown', 'keyup', 'keypress', 'wheel', 'touchstart', 'touchmove', 'dragstart', 'selectstart'];
  let layer = null, watch = null, refreshed = 0;
  const ours = event => (event.composedPath?.() || [event.target]).some(node => typeof node?.id === 'string' && node.id.startsWith('jobpilotto'));
  const hold = event => {
    if (!layer?.isConnected) { off(); return; }   // the layer was removed from outside (Stop, a settle): the holding goes with it
    if (!event.isTrusted || document.documentElement.hasAttribute('data-jobpilotto-driving') || ours(event)) return;
    event.stopImmediatePropagation();
    if (event.cancelable) event.preventDefault();
  };
  function off() {
    clearInterval(watch); watch = null;
    for (const name of HELD) window.removeEventListener(name, hold, true);
    if (layer) window.dispatchEvent(new CustomEvent('jobpilotto-overlay', {detail: false}));
    layer?.remove(); layer = null;
  }
  // The fill is on a step: the layer (re)appears, and the backstop's clock restarts.
  function on() {
    refreshed = Date.now();
    if (layer?.isConnected) return;
    layer = Object.assign(document.createElement('div'), {id: ID});
    layer.style.cssText = 'position:fixed;inset:0;z-index:2147483645;pointer-events:none;background:rgba(19,36,57,.55);';
    document.documentElement.append(layer);
    for (const name of HELD) window.addEventListener(name, hold, {capture: true, passive: false});
    window.dispatchEvent(new CustomEvent('jobpilotto-overlay', {detail: true}));   // the Report flag steps aside (panel-report.js): nothing outside the panel looks pressable
    watch = setInterval(() => { if (!chrome.runtime?.id || Date.now() - refreshed > MAX_MS) off(); }, 1000);
  }
  chrome.runtime.onMessage.addListener(message => { if (message?.type === 'stopped') off(); });
  window.__jobPilottoOverlay = {on, off, active: () => !!layer?.isConnected};
})();
