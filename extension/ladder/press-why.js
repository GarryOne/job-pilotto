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

// The named control EXISTS on the page but is not visible yet: a step comes first (Workday: "Apply Manually" is in the dialog the posting's plain "Apply" opens), so the phrase path may press the
// page's own Apply once. Absent from the page (found 0), or visible but refused by a floor (a Submit, disabled, sign-in, mail): nothing else is pressed in its place (Hornbach).
export const behindAStep = why => !!why && why.found > 0 && !why.visible;

// What a press that led nowhere did, for the log: `opens` = calls of window.open the page made after the click (-1: the page's hook is gone, it navigated or reloaded), `openMs` = ms to the first, `tabs` = tabs in this window.
// Counts only. Hornbach 11 Oct 2026: "ohne Anmeldung" pressed twice, the page never left the posting, and nothing said whether the click opened anything.
export async function clickTrace(tabId) {
  const read = await chrome.scripting.executeScript({target: {tabId}, world: 'MAIN', func: () => window.__jpOpen || null}).then(rows => rows?.[0]?.result).catch(() => null);
  const tabs = await chrome.tabs.query({currentWindow: true}).then(list => list.length).catch(() => -1);
  return {opens: read ? read.calls : -1, openMs: read ? read.firstMs : -1, tabs};
}

// What dialogs the page shows right now (counts only), logged with a fresh or digest ask so "the AI never saw the modal" can be told from "no modal was open yet" (jobs.ch, 11 Oct 2026: the log could not say).
// A closed script like pageSketchOf: no arguments. Never throws.
export async function modalTrace(tabId) {
  return chrome.scripting.executeScript({target: {tabId}, func: () => {
    const found = [...document.querySelectorAll('dialog, [role=dialog], [role=alertdialog], [aria-modal=true]')], shown = found.filter(el => el.getClientRects().length > 0);
    return {dialogs: found.length, shown: shown.length, buttons: shown.reduce((sum, el) => sum + el.querySelectorAll('button, [role=button], a').length, 0)};
  }}).then(rows => rows?.[0]?.result || null).catch(() => null);
}
