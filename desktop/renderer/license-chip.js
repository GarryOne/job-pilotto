// The small counter in the sidebar ("Free plan · 28 of 40 applications left"): which plan this is and what the number counts, at a glance
// (the numbers come from lib/license.js). It is a quota that only goes down, so its bar shows what is LEFT and drains; Settings → License
// shows the same `left` and `percent`, so the two can never disagree (0 of 40 there vs 40 of 40 here, 6 Oct 2026). The daily goal on
// Focus (applications today) is a different thing that resets each day and fills up. null when licensed: there is nothing to count.
import {byWhere} from './store-name.js';
export function chip(state) {
  if (!state || state.licensed) return null;
  const left = Math.max(0, (state.limit || 0) - (state.used || 0));
  const percent = state.limit ? Math.max(2, Math.min(100, Math.round(left / state.limit * 100))) : 0;
  const days = `${state.daysLeft} day${state.daysLeft === 1 ? '' : 's'} left`;
  if (state.ended) {
    return {plan: 'Free plan', text: 'Free period over', tone: 'warn', percent: 2, left,
      title: `Free plan: ${state.used} of ${state.limit} applications used and the free days are over. New applications, kits and searches are paused. ${byWhere('Tracking, Notion and export keep working.', 'Tracking and export keep working.')} A license key lifts the limit.`};
  }
  return {plan: 'Free plan', text: `${left} of ${state.limit} applications left`, tone: left <= 5 && state.daysLeft === 0 ? 'warn' : 'info', percent, left,
    title: `Free plan: ${state.used} of ${state.limit} applications used · ${days}. Free until you reach ${state.limit} applications and 60 days have passed, whichever comes later; then a license key lifts the limit. (Your daily goal on Focus is separate.)`};
}
