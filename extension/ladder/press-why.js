// Why the Apply button the page-kind AI NAMED was not pressed (fill-flow.js, "no Apply button to press"): evidence for the log only, no decision.
// It looks at the page's controls whose text equals the name (case and spacing aside) and returns flags and counts, never a text; `pickable` says whether
// the named-button finder (tab-pages.js pickNamedButton: the AI chose, structure finds, the floors AND) would have pressed one of them.
// Guarded by desktop/test/press-why.test.js.
import {pickNamedButton} from '../tab-pages.js';

const same = text => String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
const hrefKind = href => (!href ? 'None' : href === '#' ? 'Hash' : /^(mailto|tel|javascript):/i.test(href) ? 'Other' : 'Page');
// candidates: applyCandidates' rows. -> null without a name; else {found, pickable, and the non-zero counts of visible, enabled, submits, href kinds}.
export function whyNotPressed(candidates = [], named = '') {
  const wanted = same(named);
  if (!wanted) return null;
  const matches = candidates.filter(item => same(item?.text) === wanted);
  const pickable = !!pickNamedButton(candidates, named);
  if (!matches.length) return {found: 0, pickable};
  const counts = {found: matches.length, visible: matches.filter(item => item.visible).length, enabled: matches.filter(item => !item.disabled).length, submits: matches.filter(item => item.submits).length};
  for (const item of matches) { const key = `href${hrefKind(item.href)}`; counts[key] = (counts[key] || 0) + 1; }
  return {...counts, pickable};
}
