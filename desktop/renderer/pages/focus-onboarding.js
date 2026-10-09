// Focus → Get started (moved out of pages/focus.js, 9 Oct 2026): the first steps after the setup, and Focus without Notion, which shows only
// this list (showFocusStarted, opened by nav.js). The steps' states are renderer/onboarding.js. Guards: test/onboarding.test.js.
import {el, pill} from '../components.js';
import {icon} from '../icons.js';
import {focusMode, onboarding} from '../onboarding.js';
import {shared} from './shared.js';
import {$, show} from './core.js';
import {openView} from './nav.js';
import {lastActivity} from './activity.js';
import {notionConnected, openNotionConnect} from './notion-connect.js';
import {focusButton} from './focus.js';

let lastFunnel = null;   // Focus's funnel (its "Applied" step ticks the last step), from the last Focus that loaded

// Get started: the first steps after the setup (renderer/onboarding.js says which are done). Each button starts what the app's own button
// starts (the Actions card, the Notion dialog, Tailor's card, Apply), so a running task keeps it off the same way. Gone for good once all are done.
const ONBOARDING_GO = {
  scout: () => document.querySelector('.action[data-command="scout"]')?.click(),
  search: () => document.querySelector('.action[data-command="run"]')?.click(),
  notion: () => openNotionConnect({reason: 'focus', where: 'view', from: 'onboarding', then: () => openView('focus')}),   // connected: the whole Focus
  tailor: () => { openView('actions'); const count = $('tailor-top-n'); count?.focus(); count?.select(); },
  apply: () => { openView('jobs'); $('apply-open')?.click(); },
};
// Focus without Notion: only Get started (focusMode 'started'), the rest of the page and its Notion reads left out.
// true = shown this way; false = the caller locks the page behind the Notion gate, or loads all of Focus.
export function showFocusStarted() {
  const view = document.querySelector('.view[data-view="focus"]');
  const started = focusMode({notionConnected: notionConnected(), gettingStarted: renderOnboarding()}) === 'started';
  view?.classList.toggle('focus-started', started);
  if (started) { view?.classList.remove('notion-locked'); view?.querySelector(':scope > .notion-gate-host')?.remove(); }
  return started;
}

export function renderOnboarding({funnel} = {}) {
  if (funnel !== undefined) lastFunnel = funnel;
  const settings = shared.state?.settings || {};
  const state = onboarding({runs: lastActivity?.runs, settings, notionConnected: notionConnected(), funnel: lastFunnel});
  if (Object.keys(state.remember).length) {   // a step done once stays done, even if its run later leaves the history
    const next = {...(settings.onboarding || {}), ...state.remember};
    if (shared.state?.settings) shared.state.settings.onboarding = next;
    window.pilot.saveSettings({onboarding: next}).catch(error => console.error('onboarding not saved', error));
  }
  show($('focus-onboarding'), state.show);
  if (!state.show) return false;
  $('onboarding-count').replaceChildren(pill(`${state.doneCount} of ${state.steps.length}`, 'neutral'));
  const nextAt = state.steps.indexOf(state.next) + 1;
  $('onboarding-list').replaceChildren(...state.steps.map((step, i) => {
    const isNext = step === state.next;
    const li = el('li', `focus-item tone-${step.done ? 'good' : isNext ? 'info' : 'neutral'}${step.done ? ' is-done' : ''}`);
    const round = el('span', 'focus-round onboarding-num');   // the step's number: they're meant in this order (a search finds more after step 1)
    round.append(step.done ? icon('tick') : String(i + 1));
    const body = el('div', 'focus-body');
    const top = el('div', 'focus-top');
    top.append(el('span', 'focus-headline', step.label), pill(step.done ? 'Done' : isNext ? 'Next step' : 'To do', step.done ? 'good' : isNext ? 'info' : 'neutral', {dot: true}));
    body.append(top, el('div', 'focus-meta muted small', step.hint));
    const actions = el('div', 'focus-actions');
    // Only the next step can be started: a later one waits for it ("After step 1"), so a search never runs before the employers are found.
    if (isNext) actions.append(focusButton(step.button, 'primary', ONBOARDING_GO[step.key]));
    else if (!step.done) actions.append(el('span', 'muted small', `After step ${nextAt}`));
    li.append(round, body, actions);
    return li;
  }));
  return true;
}
