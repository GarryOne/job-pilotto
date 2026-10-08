// Strategy page: the search strategy and its coverage, read from Notion, with a link to edit it there. Entry: loadStrategy and init; the cards are strategy-targets.js and strategy-suggestions.js, shared state strategy-state.js. Guarded by: advice-events, save-progress, activity-selection-kept tests.
import {openInNotion} from './notion-connect.js';
import {el, tile} from '../components.js';
import {icon} from '../icons.js';
import {shared} from './shared.js';
import {$, message, savedAgo, show} from './core.js';
import {bone} from './focus.js';
import {guardLeave, openView} from './nav.js';
import {toastMessage} from './startup.js';
import {strategyState, showTab} from './strategy-state.js';
import {CARD_TONE, TARGET_CARDS, dirty, inColumns, discardTargets, saveTargets, renderStrategy} from './strategy-targets.js';
import {pendingImprove, drawImprove, loadCoverage} from './strategy-suggestions.js';
export {TARGET_CARDS, TARGET_LISTS, editedList} from './strategy-targets.js';
export {reviewSuggestion, loadCoverage} from './strategy-suggestions.js';

export async function loadStrategy() {
  shared.state = await window.pilot.state();
  message('strategy-message', '');
  pendingImprove.add('previous');   // the older scores come with the fresh read only (the saved copy leaves them out)
  loadCoverage({first: true});   // beside the strategy read, so the cards are there when the page first shows
  // The last good read at once (lib/view-cache.js), then the fresh one.
  const saved = await window.pilot.cached('strategy');
  if (saved?.result?.ok && !strategyState.strategyShown) {
    // The saved copy draws the page at once, but not its alerts about what changes: "Your Profile is empty" and "N scores kept" came back
    // for a few seconds after every refresh, from a copy older than the rebuild that cleared them (7 Oct 2026). The fresh read shows them.
    renderStrategy({...saved.result, profile_empty: false, previous: 0});
    $('strategy-synced').textContent = `Saved ${savedAgo(saved.at)} · updating…`;
  } else if (!strategyState.strategyShown) strategySkeleton();
  const data = await window.pilot.strategyData().catch(error => ({ok: false, error: error.message}));
  if (!data.ok) { pendingImprove.delete('previous'); drawImprove(); $('strategy-view-loading')?.remove(); message('strategy-load', data.error, 'error'); return; }
  message('strategy-load', '');
  $('strategy-view-loading')?.remove();
  pendingImprove.delete('previous');
  renderStrategy(data);
  $('strategy-synced').textContent = `Synced ${new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}`;
}
// First load: every card in its final shape, greyed (the same rows, icons and chips), and a pill in the header.
function strategySkeleton() {
  const chipBones = n => { const box = el('div', 'chip-list'); for (let i = 0; i < n; i++) box.append(bone('chip')); return box; };
  // The target cards themselves (TARGET_CARDS: head, then each list's label and chips), greyed. 7 Oct 2026: the old Roles/Locations rows,
  // left from before the cards, fell into the cards' grid as loose lines.
  $('strategy-targets').replaceChildren(...inColumns(TARGET_CARDS.map(([key, glyph, title, lists]) => {
    const card = el('section', 'card is-loading'), head = el('div', 'card-head'), heading = el('h3');
    card.dataset.list = key;
    heading.append(tile(glyph, CARD_TONE[key] || 'neutral'), title);
    head.append(heading);
    card.append(head);
    for (const [name, label] of lists) {
      if (name === 'places') { const priority = el('div', 'priority'); priority.append(el('b', '', label), chipBones(2)); card.append(priority); continue; }
      if (label) card.append(el('p', 'sub', label));
      card.append(chipBones(lists.length > 1 ? 2 : 3));
    }
    return card;
  })));
  $('strategy-scores').replaceChildren(...['settings', 'layers', 'pin', 'chart'].map(glyph => {
    const line = el('div', 'score-bar is-loading');
    line.append(icon(glyph), bone('w-name tall'), bone('w-track'), bone('w-level'));
    return line;
  }));
  $('strategy-glance').replaceChildren(...['file', 'layers', 'send'].map(glyph => {
    const line = el('div', 'glance-row is-loading');
    line.append(tile(glyph, 'neutral'), bone('w-count tall'), bone('w-label'), el('span', 'glance-arrow', '›'));
    return line;
  }));
  const insight = $('strategy-insight');
  insight.hidden = false;
  insight.classList.add('is-loading');
  $('strategy-insight-text').replaceChildren(bone('w-80'), bone('w-60'));
  const pill = el('span', 'loading-pill', 'Loading strategy…');
  pill.id = 'strategy-view-loading';
  $('strategy-synced').replaceChildren(pill);
}
// Leaving Strategy with unsaved changes: the one place the draft asks (Save / Discard / Keep editing). Switching tabs never asks.
function leaveStrategy(proceed) {
  if (!strategyState.targetEdits || !dirty().size) return true;
  const dialog = $('strategy-leave-dialog');
  dialog.returnValue = '';
  dialog.onclose = async () => {
    if (dialog.returnValue === 'discard') { discardTargets(); proceed(); }
    if (dialog.returnValue === 'save' && await saveTargets()) proceed();
  };
  dialog.showModal();
  return false;
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  // A page read through the extension (Sites only you can open): said wherever the window is, once per page.
  // Few new jobs twice in a row (lib/few-jobs.js): a dot on Strategy until it is opened.
  window.pilot.onFewJobs?.(() => show($('strategy-dot'), true));
  document.querySelector('.nav[data-view=strategy]')?.addEventListener('click', () => show($('strategy-dot'), false));
  window.pilot.onVisitRead?.(answer => toastMessage(answer.fits === undefined ? `Read ${answer.jobs} jobs from ${answer.name}` : `Read ${answer.jobs} jobs from ${answer.name}, ${answer.fits} matching your search`,
    answer.fits ? 'Your next jobs check scores the matching ones: those that fit your profile join your Jobs list.' : 'The reading works; none of these match your role words and places, so your Jobs list stays the same.'));
  for (const tab of document.querySelectorAll('.strategy-tabs [data-tab]')) tab.addEventListener('click', () => showTab(tab.dataset.tab));
  guardLeave('strategy', leaveStrategy);
  $('profile-empty-rebuild').addEventListener('click', () => $('strategy-redo').click());   // the same Rebuild from CV as the Profile page
  $('targets-cancel').addEventListener('click', discardTargets);
  $('targets-save').addEventListener('click', saveTargets);
  $('strategy-edit').addEventListener('click', event => openInNotion(shared.state.notion?.NOTION_SEARCH_SETTINGS_PAGE ? 'NOTION_SEARCH_SETTINGS_PAGE' : 'NOTION_PROFILE_PAGE_ID', event));   // busy state: openInNotion
  $('strategy-jobs').addEventListener('click', () => openView('jobs'));
}

