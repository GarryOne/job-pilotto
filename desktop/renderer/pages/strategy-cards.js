// Strategy's cards as one system (owner, 18 Oct 2026, UI redesign B, decision 4): each card reads as a summary with a quiet Edit; Edit opens only that
// card's editor (opening another keeps the first one's draft, its summary shows the draft with "Unsaved"); Esc closes an editor, its draft kept, and
// card-shell.js doneButton closes one that holds no change;
// nothing saves per card: Strategy's one page bar (save-bar.js pageSaveBar, "Save strategy changes") saves or discards every card's draft, and never a
// Profile draft. Goals follow the same Edit → Save. The cards: Main goals (main-goals.js), Locations and the Advanced ones (strategy-targets.js), Job
// preferences (job-preferences.js, through outline-tab.js's {bar}). Guarded by test/strategy-cards.test.js.
import {cardEdit, pill} from '../components.js';
import {cardHead, doneButton, setEditing} from '../card-shell.js';
import {pageSaveBar} from '../save-bar.js';
import {$} from './core.js';
import {strategyState, showTab} from './strategy-state.js';
import {dirtyLists, withTyped} from '../strategy-parts.js';

// card key → what its draft holds: lists and one-value settings (Search settings, lib/strategy-edit.js) and goals (the Profile, lib/goals.js).
export const CARDS = {
  goals: {title: 'Main goals', lists: ['roles'], values: [], goals: ['seniority', 'work_mode', 'minimum_salary']},
  places: {title: 'Locations', lists: ['places', 'country', 'abroad', 'rights'], values: ['remote', 'relocation']},
  queries: {title: 'Job board searches', lists: ['queries'], values: []},
  stack: {title: 'Skills & experience', lists: ['stack'], values: []},
  languages: {title: 'Exclusions & preferences', lists: ['languages'], values: []},
  search: {title: 'More search settings', lists: ['titleSkip', 'skip', 'remoteSkip', 'finders', 'gqueries', 'gplaces'], values: ['level', 'minScore']},
  // Job preferences keeps its drafts in pages/outline-tab.js and registers with the bar itself (barFor); job-preferences.js sets its count.
  prefs: {title: 'Job preferences', lists: [], values: [], own: true, count: () => 0},
};
export const GOAL_LABELS = {seniority: 'Target level', work_mode: 'Work mode', minimum_salary: 'Minimum salary'};
export const cardOf = name => Object.keys(CARDS).find(key => CARDS[key].lists.includes(name) || CARDS[key].values.includes(name)) || '';
export const PLAIN = new Set(['queries', 'languages', 'skip', 'gqueries', 'gplaces']);   // stored as typed, not lower-cased

// The drafts: strategyState.targetEdits (lists and values), strategyState.typed (words still in an add field), strategyState.goalEdits (goal → text).
export const drafts = () => {
  strategyState.targetEdits ||= {};
  strategyState.typed ||= {};
  strategyState.goalEdits ||= {};
  return strategyState;
};
export const dirty = () => dirtyLists(drafts().targetEdits, drafts().typed);
export function cardCount(key) {
  const card = CARDS[key], changed = dirty();
  return [...card.lists, ...card.values].filter(name => changed.has(name)).length + (card.goals || []).filter(goal => goal in drafts().goalEdits).length + (card.count?.() || 0);
}
export const isOpen = key => strategyState.editing === key;

// The card's header: its tile and title, "Unsaved" while it holds a draft, and a quiet Edit (the shared Done while its editor is open). card: its section.
export function cardHeader(key, glyph, tone, title = CARDS[key].title, lead = '', card = null) {
  const badge = pill('Unsaved', 'warn');
  badge.classList.add('unsaved-badge');
  badge.hidden = !cardCount(key);
  let action;
  if (isOpen(key)) {
    action = doneButton(card, () => cardCount(key));
    action.addEventListener('click', closeCard);
  } else action = cardEdit('Edit', title.toLowerCase(), () => openCard(key));
  return cardHead({glyph, tone, title, lead, badge, action});
}

let redraw = () => {};   // strategy.js: Main goals + the target cards (strategy-targets.js renderCards)
export const redrawCards = () => redraw();
export function openCard(key) {
  drafts();
  strategyState.editing = key;
  redraw();
  const card = document.querySelector(`.strategy-page [data-card="${key}"]`);
  if (card?.closest('details')) card.closest('details').open = true;
  setEditing(card, true);
  card?.querySelector('input, select, textarea, button.chip, .segmented button')?.focus({preventScroll: true});
}
export function closeCard() {
  if (!strategyState.editing) return;
  strategyState.editing = '';
  redraw();
}
// Typing redraws only the badges and the bar, so a field keeps its focus.
export function changed() {
  for (const card of document.querySelectorAll('.strategy-page [data-card]')) {
    const badge = card.querySelector('.unsaved-badge');
    if (badge) badge.hidden = !cardCount(card.dataset.card);
    card.querySelector('.card-done')?.sync?.();
  }
  bar?.changed();
}

// ---------- The one bar ----------
let bar = null, reloading = null;
// deps: {redraw, reload, entriesOf}: redraw the cards from the drafts; reload the strategy after a save; a list's stored entries.
export function strategyBar(deps) {
  if (bar) return bar;
  redraw = deps.redraw;
  bar = pageSaveBar({host: $('strategy-bar-host'), tabs: {'strategy-yours': 'Your strategy'}, tabButton: key => document.querySelector(`.strategy-tabs [data-tab="${key}"]`),
    openTab: showTab, area: 'Strategy', saveLabel: 'Save strategy changes', words: 'Applies to future searches.', savedWords: 'Saved ✓ Refresh your jobs to search with it.'});
  const reloadSoon = () => { clearTimeout(reloading); reloading = setTimeout(deps.reload, 50); };
  for (const [key, card] of Object.entries(CARDS)) {
    if (card.own) continue;
    const names = [...card.lists, ...card.values];
    const edits = () => {
      const all = withTyped(drafts().targetEdits, drafts().typed, PLAIN, deps.entriesOf), now = dirty();
      return Object.fromEntries(Object.entries(all).filter(([name]) => names.includes(name) && (now.has(name) || all[name]?.add?.length)));
    };
    const forget = list => { for (const name of list) { delete drafts().targetEdits[name]; delete drafts().typed[name]; } };
    bar.register({id: `strategy-${key}`, tab: 'strategy-yours', label: card.title, count: () => cardCount(key),
      validate() {
        const tooLong = Object.values(edits()).flatMap(edit => edit.add || []).find(word => word.length > 80);
        return tooLong ? {ok: false, error: `"${tooLong.slice(0, 30)}…" is too long for one entry (80 characters at most)`} : {ok: true};
      },
      async save() {
        const lists = edits();
        if (Object.keys(lists).length) {
          const result = await window.pilot.editTargets(lists).catch(error => ({ok: false, error: error.message}));
          if (!result?.ok) return {ok: false, error: result?.error || 'try again'};
          forget(names);
        }
        for (const goal of (card.goals || []).filter(each => each in drafts().goalEdits)) {
          const result = await window.pilot.editGoal(goal, drafts().goalEdits[goal]).catch(error => ({ok: false, error: error.message}));
          if (!result?.ok) return {ok: false, field: GOAL_LABELS[goal], error: result?.error || 'try again'};
          delete drafts().goalEdits[goal];
        }
        if (isOpen(key)) strategyState.editing = '';
        reloadSoon();
        return {ok: true};
      },
      discard() {
        forget(names);
        for (const goal of card.goals || []) delete drafts().goalEdits[goal];
        if (isOpen(key)) strategyState.editing = '';
        redraw();
      },
      reveal: () => openCard(key)});
  }
  // Esc closes the open editor (its draft stays); a menu or dialog open over the page keeps its own Esc.
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !strategyState.editing || event.defaultPrevented || document.querySelector('dialog[open]')) return;
    if (document.querySelector('.view[data-view=strategy]')?.hidden) return;
    closeCard();
  });
  return bar;
}
export const strategyBarNow = () => bar;
// The bar for a card that registers its own source (Job preferences through outline-tab.js): its changes also repaint the cards' Unsaved pills.
export const barFor = () => bar && {register(spec) {
  const source = bar.register(spec);
  return {...source, changed: () => { source.changed(); changed(); }};
}};
