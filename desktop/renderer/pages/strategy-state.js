// Strategy page, shared state: one strategyState object (a value reassigned later stays ONE binding for every piece) and the tab switch. Guarded by: the Strategy tests (advice-events, save-progress).
import {$, show} from './core.js';

export const strategyState = {
  strategyShown: false,
  lastStrategy: null,
  // The drafts, kept per card until the page bar saves or discards them (pages/strategy-cards.js): lists and values, words still in an add field, goals.
  targetEdits: null,   // {list: {add: [words], remove: [stored entries]}, remote: {set}}
  typed: null,   // {list: text}
  goalEdits: null,   // {goal: text}
  editing: '',   // the one card whose editor is open
  shownVerdict: null,
};

// Tabs (owner, 7 Oct 2026): each replaces the content under the bar; the draft and its save bar stay whatever the tab.
export function showTab(id) {
  document.querySelector('.strategy-page')?.setAttribute('data-tab', id);   // the suggestions line hides on Suggestions itself (style.css)
  for (const tab of document.querySelectorAll('.strategy-tabs [data-tab]')) {
    const on = tab.dataset.tab === id;
    tab.classList.toggle('is-active', on);
    tab.setAttribute('aria-selected', String(on));
    show($(tab.dataset.tab), on);
  }
}

