// The small counter in the sidebar ("28 free applications left"): where the user stands, at a glance (the numbers come from lib/license.js).
// null when licensed: there is nothing to count.
export function chip(state) {
  if (!state || state.licensed) return null;
  const left = Math.max(0, (state.limit || 0) - (state.used || 0));
  const percent = state.limit ? Math.max(2, Math.min(100, Math.round(state.used / state.limit * 100))) : 0;
  const days = `${state.daysLeft} day${state.daysLeft === 1 ? '' : 's'} left`;
  if (state.ended) {
    return {text: 'Free period over', tone: 'warn', percent: 100,
      title: `${state.used} of ${state.limit} free applications used and the free days are over. Tracking, Notion and export keep working.`};
  }
  return {text: `${left} free application${left === 1 ? '' : 's'} left`, tone: left <= 5 && state.daysLeft === 0 ? 'warn' : 'info', percent,
    title: `${state.used} of ${state.limit} free applications · ${days}. Free until you reach ${state.limit} applications and 60 days have passed, whichever comes later.`};
}
