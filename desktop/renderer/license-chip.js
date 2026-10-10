// The small counter in the sidebar ("Free plan · 12 of 20 applications used"): which plan this is and what the number counts, at a glance
// (the numbers come from lib/license.js). It counts the applications USED (owner, 10 Oct 2026), so its bar fills, blue until the last 5 are left, then red; Settings → License
// shows the same `used` and `percent`, so the two can never disagree (0 of 40 there vs 40 of 40 here, 6 Oct 2026). The daily goal on
// Focus (applications today) is a different thing that resets each day and fills up. null when licensed: there is nothing to count.
import {byWhere} from './store-name.js';
export function chip(state) {
  if (!state || state.licensed) return null;
  const left = Math.max(0, (state.limit || 0) - (state.used || 0));
  const used = Math.min(state.used || 0, state.limit || 0);
  const percent = state.limit ? Math.max(2, Math.min(100, Math.round(used / state.limit * 100))) : 0;
  const days = `${state.daysLeft} day${state.daysLeft === 1 ? '' : 's'} left`;
  if (state.ended) {
    return {plan: 'Free plan', text: 'Free period over', tone: 'bad', percent: 100, left, used,
      title: `Free plan: ${state.used} of ${state.limit} applications used and the free days are over. New applications, kits and searches are paused. ${byWhere('Tracking, Notion and export keep working.', 'Tracking and export keep working.')} A license key lifts the limit.`};
  }
  return {plan: 'Free plan', text: `${used} of ${state.limit} applications used`, tone: left <= 5 ? 'bad' : 'info', percent, left, used,
    title: `Free plan: ${state.used} of ${state.limit} applications used · ${days}. Free until you reach ${state.limit} applications and 60 days have passed, whichever comes later; then a license key lifts the limit. (Your daily goal on Focus is separate.)`};
}
