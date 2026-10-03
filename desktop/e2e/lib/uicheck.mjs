/* global document, getComputedStyle */
// Deterministic UI checks, run on every page the journey visits: the layout bugs a person sees at a glance and a unit test never does
// (2 Oct 2026: one job row was twenty lines tall). Cheap and exact, no AI. Each finding: {view, severity, kind, detail}.
//   severe  -> fails the journey (the page is visibly broken)
//   warning -> reported, shown in the summary
export const VIEWS = ['focus', 'jobs', 'strategy', 'interviews', 'calendar', 'actions', 'sessions', 'settings'];
export const LIMITS = {rowHeight: 220, cellHeight: 200, minFont: 10};

// Runs inside the page. Returns plain findings (no DOM nodes).
export function inspect({view, limits}) {
  const found = [];
  const visible = el => { const box = el.getBoundingClientRect(); return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden' && el.offsetParent !== null; };
  const label = el => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''}`;
  const snippet = el => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const root = document.querySelector(`.view[data-view="${view}"]`) || document.body;
  if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 2) {
    // Name what sticks out (the outermost few), so the finding says where to look.
    const edge = document.documentElement.clientWidth + 2;
    const wide = [...document.body.querySelectorAll('*')].filter(el => visible(el) && el.getBoundingClientRect().right > edge)
      .filter(el => ![...el.children].some(child => visible(child) && child.getBoundingClientRect().right > edge))
      .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right).slice(0, 3)
      .map(el => `${label(el)} (right edge ${Math.round(el.getBoundingClientRect().right)}px)`);
    found.push({view, severity: 'severe', kind: 'page-overflow', detail: `the page scrolls sideways (${document.documentElement.scrollWidth}px wide in a ${document.documentElement.clientWidth}px window)${wide.length ? `; sticking out: ${wide.join(', ')}` : ''}`});
  }
  for (const el of root.querySelectorAll('.job-row, tr, li, .card, .place, [class*="cell"]')) {
    if (!visible(el)) continue;
    const height = Math.round(el.getBoundingClientRect().height);
    const isRow = el.matches('.job-row, tr');
    const limit = isRow ? limits.rowHeight : limits.cellHeight;
    if (height > limit && !el.matches('.card') && el.children.length < 40) {
      found.push({view, severity: isRow ? 'severe' : 'warning', kind: isRow ? 'tall-row' : 'tall-cell', detail: `${label(el)} is ${height}px tall (limit ${limit}): "${snippet(el)}"`});
    }
  }
  const clipped = [];
  for (const el of root.querySelectorAll('h1, h2, h3, b, span, a, button, p, td, label')) {
    if (!visible(el) || el.children.length > 2) continue;
    const style = getComputedStyle(el);
    if (el.scrollWidth > el.clientWidth + 3 && style.overflowX !== 'visible' && style.textOverflow !== 'ellipsis' && el.clientWidth > 0) clipped.push(el);
  }
  for (const el of clipped.slice(0, 5)) found.push({view, severity: 'warning', kind: 'clipped-text', detail: `${label(el)} cuts its text off: "${snippet(el)}"`});
  // Text that runs out of its box and stays visible (overflow: visible), the opposite of clipped: the brand in the icon rail spilling over the page title, a button label running out of its
  // button (2 Oct 2026, issue #47). In the page, and in the app chrome around it (the sidebar and the bottom bar), which the page's own root does not contain.
  const spills = (scope, isChrome) => {
    const hits = [scope, ...scope.querySelectorAll('aside, nav, header, footer, button, a, b, span, p, h1, h2, h3, label, td, li, .card, .brand, .nav, .pill, .tag')].filter(el => {
      if (!visible(el) || !(el.textContent || '').trim()) return false;
      return getComputedStyle(el).overflowX === 'visible' && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 3;
    });
    return hits.filter(el => !hits.some(other => other !== el && el.contains(other))).slice(0, 4)   // the innermost: the container only spills because of what is in it
      .map(el => ({view, severity: 'warning', kind: 'spill', chrome: isChrome, detail: `${label(el)} content runs out of its box (${el.scrollWidth}px of ${el.clientWidth}px): "${snippet(el)}"`}));
  };
  found.push(...spills(root, false));
  for (const area of document.querySelectorAll('.sidebar, #activity')) found.push(...spills(area, true));
  for (const el of root.querySelectorAll('*')) {
    if (!visible(el) || !el.childNodes.length || ![...el.childNodes].some(node => node.nodeType === 3 && node.textContent.trim())) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);   // size 0 hides a label on purpose (the nav buttons of the icon rail): not tiny text
    if (size > 0 && size < limits.minFont) { found.push({view, severity: 'warning', kind: 'tiny-text', detail: `${label(el)} text is under ${limits.minFont}px: "${snippet(el)}"`}); break; }
  }
  for (const img of root.querySelectorAll('img')) {
    if (visible(img) && img.complete && img.naturalWidth === 0) found.push({view, severity: 'severe', kind: 'broken-image', detail: `${label(img)} does not load`});
  }
  for (const button of root.querySelectorAll('button, a[href]')) {
    if (visible(button) && !(button.textContent || '').trim() && !button.getAttribute('aria-label') && !button.title && !button.querySelector('svg, img')) {
      found.push({view, severity: 'warning', kind: 'unnamed-control', detail: `${label(button)} has no text, label or icon`}); break;
    }
  }
  return found;
}
