// Every card on a Profile tab folds to its title and a one-line summary, and one bar at the bottom of the page opens or folds ALL the cards of the tab you are on, never another tab's
// (owner, 18 Oct 2026: "all the tabs in Profile", "it should close/expand only the cards in the current tab"). The panels use the shared collapsiblePanel (components.js, remembered per
// panel); the Experience cards (details.qa-fold, pages/experience-profile.js) are folded through the same registry. Guarded by test/profile-fold.test.js.
import {collapsiblePanel} from './components.js';

export const TABS = ['cv', 'details', 'experience', 'answers', 'letter'];
// Tell the bar that a card folded, opened or was drawn.
export const foldsChanged = () => document.dispatchEvent(new Event('profile-folds-changed'));
const registry = new Map();   // node -> {tab, set(folded), isFolded()}
export const registered = () => registry;

// The pure part: fold (or open) every registered card of one tab and no other.
export function foldTab(cards, tab, folded) {
  let touched = 0;
  for (const card of cards.values()) if (card.tab === tab) { card.set(folded); touched++; }
  return touched;
}
// "N cards · M open" for the bar.
export function countTab(cards, tab) {
  const own = [...cards.values()].filter(card => card.tab === tab && (card.visible?.() ?? true));
  return {cards: own.length, open: own.filter(card => !card.isFolded()).length};
}

// The one line a folded card shows: how much it holds (filled boxes, rows), read from the card when it folds.
export function summaryOf(panel) {
  if (panel.dataset.summary) return panel.dataset.summary;   // a card that says it in its own words (the CV check: "Mostly readable · 3 issues")
  const fields = [...panel.querySelectorAll('input, textarea, select')].filter(node => !['checkbox', 'radio', 'hidden', 'button', 'file'].includes(node.type) && !node.closest('[hidden]'));
  if (fields.length) return `${fields.filter(node => String(node.value || '').trim()).length} of ${fields.length} filled`;
  const rows = panel.querySelectorAll('.summary-rows dt, .fact-line, .exp-part').length;
  if (rows) return `${rows} ${rows === 1 ? 'item' : 'items'}`;
  return '';
}

function titleBar(panel) {
  let bar = panel.querySelector(':scope > .panel-top');
  if (bar) return bar;
  const head = panel.querySelector(':scope > .summary-head');
  if (!head) return null;
  bar = document.createElement('div');
  bar.className = 'panel-top';
  head.before(bar);
  bar.append(head);
  return bar;
}

// Make every Profile panel a foldable card; ids in `closed` start folded (long detail cards), the rest open unless the person left them folded.
export function foldProfilePanels({closed = new Set()} = {}) {
  for (const panel of document.querySelectorAll('.setting.panel[data-profile-panel]')) {
    const bar = titleBar(panel);
    if (!bar) continue;
    const handle = collapsiblePanel(panel, panel.id, {collapsed: closed.has(panel.id)});
    if (!handle) continue;
    const summary = document.createElement('span');
    summary.className = 'panel-summary muted small';
    bar.classList.add('has-summary');   // components.css: title | summary | actions as three columns, the summary in one column down the tab
    (bar.querySelector('.summary-head') || bar).after(summary);   // right after the title
    const refresh = () => { summary.textContent = panel.classList.contains('is-collapsed') ? summaryOf(panel) : ''; };
    new MutationObserver(refresh).observe(panel, {attributes: true, attributeFilter: ['class', 'data-summary']});   // folded, opened, or its own summary changed
    refresh();
    registry.set(panel, {tab: panel.dataset.profilePanel, set: folded => handle.set(folded), isFolded: () => panel.classList.contains('is-collapsed'), visible: () => !panel.hidden});
  }
}

// The Experience cards (details.qa-fold) join the registry as they are drawn.
export function registerCard(node, tab) {
  registry.set(node, {tab, set: folded => { if (node.open === folded) { node.open = !folded; node.dispatchEvent(new Event('toggle')); } }, isFolded: () => !node.open, visible: () => node.offsetParent !== null});
}
export function forgetCards(tab) { for (const [node, card] of registry) if (card.tab === tab && node.tagName === 'DETAILS') registry.delete(node); }

const openTab = () => document.querySelector('[data-profile-tab].is-active')?.dataset.profileTab;
export function showFoldBar() {
  const bar = document.getElementById('profile-foldbar'), tab = openTab();
  if (!bar || !tab) return;
  const {cards, open} = countTab(registry, tab);
  bar.hidden = cards === 0;
  const count = bar.querySelector('.foldbar-count');
  if (count) count.textContent = `${open} of ${cards} open`;
}
export function initFoldBar() {
  const bar = document.getElementById('profile-foldbar');
  if (!bar) return;
  bar.querySelector('[data-fold="open"]').addEventListener('click', () => { foldTab(registry, openTab(), false); showFoldBar(); });
  bar.querySelector('[data-fold="close"]').addEventListener('click', () => { foldTab(registry, openTab(), true); showFoldBar(); });
  document.addEventListener('profile-folds-changed', showFoldBar);
}
