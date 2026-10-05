/* global window, document, performance, PerformanceObserver */
// Content that MOVES after the page has finished loading (5 Oct 2026, the owner's find): on Strategy a "Your search may be too narrow" card appeared five seconds after the page
// stood still and pushed everything down, with no loading sign before it. A screenshot shows only the end; this watches the window's own layout-shift record (what the browser
// measures for a page that jumps) from the moment the page says it is ready, and files what moved on its own. A shift that follows a person's click or key never counts.
const MIN_VALUE = 0.05;   // the browser's score: share of the window that moved x how far (a one-line chip appearing is far below it, a card pushing a page down far above). Its rectangles are
                          // clipped to the window, so a pixel distance would lie for a long page: only the score gates.

// Runs in the page (idempotent): records every layout shift with the moment it happened.
export function watchShifts() {
  if (window.__jpShifts) return;
  window.__jpShifts = [];
  const name = node => (node && node.nodeType === 1 ? `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}${typeof node.className === 'string' && node.className.trim() ? `.${node.className.trim().split(/\s+/)[0]}` : ''}` : '');
  try {
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        const moved = (entry.sources || []).flatMap(source => [Math.abs((source.currentRect?.top || 0) - (source.previousRect?.top || 0)), Math.abs((source.currentRect?.bottom || 0) - (source.previousRect?.bottom || 0))]);   // a box that grew moved its bottom, not its top
        window.__jpShifts.push({at: Math.round(performance.now()), value: entry.value, input: !!entry.hadRecentInput, px: Math.round(Math.max(0, ...moved)), node: name(entry.sources?.[0]?.node)});
      }
    }).observe({type: 'layout-shift', buffered: false});
  } catch { /* an engine without the record: nothing is watched, nothing is filed */ }
}
export const nowInPage = () => Math.round(performance.now());
export const shiftsIn = () => window.__jpShifts || [];
export const startedBy = () => !!document.querySelector('.view:not([hidden])');

// Pure. `shifts`: the page's record; `since`: the page's own clock when it said it was ready. -> findings (at most one per page), or [].
export function lateShiftFindings({view, shifts = [], since = 0, quietMs = 0}) {
  const late = shifts.filter(item => item.at >= since + quietMs && !item.input);
  const value = late.reduce((sum, item) => sum + item.value, 0);
  if (value < MIN_VALUE) return [];
  const first = late[0], seconds = Math.max(0, (first.at - since) / 1000).toFixed(1);
  return [{view, severity: 'warning', kind: 'late-shift', source: 'layout-check',
    detail: `content on ${view} moved by itself ${seconds}s after the page was ready (shift score ${value.toFixed(2)}, ${late.length} jump${late.length === 1 ? '' : 's'}, first at ${first.node || 'an element'}): something appeared with no loading sign and pushed the page while it was being read`}];
}
