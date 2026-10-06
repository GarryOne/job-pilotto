// Focus → Get started: the first steps after the setup, in order, each ticked from what really happened (owner, 6 Oct 2026).
// Pure (no DOM): pages/focus.js draws it. A step once done stays done (settings.onboarding), and the card is gone for good once every step is.

export const STEPS = [
  {key: 'scout', label: 'Find new employers', hint: 'Adds employers’ career sites to search · a few minutes', button: 'Run'},
  {key: 'search', label: 'Search for new jobs', hint: 'Searches every job site, then AI scores the new jobs', button: 'Run'},
  {key: 'notion', label: 'Connect Notion', hint: 'Where your applications are tracked', button: 'Connect'},
  {key: 'tailor', label: 'Tailor CVs for top matches', hint: 'A CV rewritten for each of your best matches', button: 'Open'},
  {key: 'apply', label: 'Apply to your first job', hint: 'The extension fills the form; you press Submit', button: 'Apply'},
];

const finished = (runs, kind) => (runs || []).filter(run => run.kind === kind && run.ok !== false && !run.live && run.endedAt);
const newest = list => Math.max(0, ...list.map(run => Number(run.id) || 0));

// What each step's state is now. runs: Recent activity's records; funnel: Focus's (its "Applied" step); saved: settings.onboarding.
export function onboarding({runs = [], settings = {}, notionConnected = false, funnel = null} = {}) {
  const saved = settings.onboarding || {};
  const scoutAt = Math.max(newest(finished(runs, 'scout')), Date.parse(settings.lastScoutAt || '') || 0);
  const searches = finished(runs, 'search');
  const searchAt = Math.max(newest(searches), settings.lastSearchOk ? Date.parse(settings.lastSearchAt || '') || 0 : 0);
  const applied = (funnel?.steps || []).find(step => /applied/i.test(step.step || ''))?.reached || 0;
  const now = {
    scout: scoutAt > 0,
    search: scoutAt > 0 && searchAt > scoutAt,   // a search after the employers were found: that's the one that brings their jobs
    notion: notionConnected,
    tailor: finished(runs, 'tailor').length > 0,
    apply: applied > 0,
  };
  const steps = STEPS.map(step => ({...step, done: !!(saved[step.key] || now[step.key])}));
  const next = steps.find(step => !step.done) || null;
  const doneCount = steps.filter(step => step.done).length;
  const remember = Object.fromEntries(steps.filter(step => step.done && !saved[step.key]).map(step => [step.key, true]));
  return {steps, next, doneCount, allDone: !next, show: !!next && !saved.done && !saved.hidden,
    remember: !next && !saved.done ? {...remember, done: true} : remember};   // what to add to settings.onboarding now ({} = nothing)
}
