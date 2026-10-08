// The panel's first seconds on a page the app opened to fill: its button spins with "Starting…" until the fill says its own first step
// (owner, 9 Oct 2026: a plain "Fill this form" sat there for a few seconds and looked stuck). Once per tab and page, gone after 30 s if no
// fill follows. The panel asks for the step when it appears (messages-learning.js panelStepNow, review.js showStep with a longer wait).
// Guard: desktop/test/extension-panel-start.test.js.
export const STARTING = 'Starting…';
const started = new Set();

export function noteStart(stepNow, tabId, url, later = setTimeout) {
  const key = `${tabId} ${url}`;
  if (stepNow.has(tabId) || started.has(key)) return false;
  started.add(key);
  stepNow.set(tabId, STARTING);
  later(() => { if (stepNow.get(tabId) === STARTING) stepNow.delete(tabId); }, 30000);
  return true;
}
