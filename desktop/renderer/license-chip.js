// The small counter in the sidebar ("Free plan · 28 of 40 applications left"): which plan this is and what the number counts, at a glance
// (the numbers come from lib/license.js). It is a quota that only goes down, so its bar shows what is LEFT and drains; the daily goal on
// Focus (applications today) is a different thing that resets each day and fills up. null when licensed: there is nothing to count.
export function chip(state) {
  if (!state || state.licensed) return null;
  const left = Math.max(0, (state.limit || 0) - (state.used || 0));
  const percent = state.limit ? Math.max(2, Math.min(100, Math.round(left / state.limit * 100))) : 0;
  const days = `${state.daysLeft} day${state.daysLeft === 1 ? '' : 's'} left`;
  if (state.ended) {
    return {plan: 'Free plan', text: 'Free period over', tone: 'warn', percent: 2,
      title: `Free plan: ${state.used} of ${state.limit} applications used and the free days are over. New applications, kits and searches are paused. Tracking, Notion and export keep working. A license key lifts the limit.`};
  }
  return {plan: 'Free plan', text: `${left} of ${state.limit} applications left`, tone: left <= 5 && state.daysLeft === 0 ? 'warn' : 'info', percent,
    title: `Free plan: ${state.used} of ${state.limit} applications used · ${days}. Free until you reach ${state.limit} applications and 60 days have passed, whichever comes later; then a license key lifts the limit. (Your daily goal on Focus is separate.)`};
}
