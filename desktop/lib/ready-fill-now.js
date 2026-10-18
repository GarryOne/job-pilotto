// Fill now's plan (owner, 18 Oct 2026: "make the Fill now work", one press sends and starts): from tonight's ready jobs, the jobs you opened but did not submit, and the forms
// a send would replace, decide to send at once, ask first, or say there is nothing to fill. Pure: the handler (lib/ready-handlers.js) acts on it. Guard: test/ready-fill-now.test.js.

// tonight: the jobs pickToSend gives; opened: pickToRefill's (opened in your browser, not submitted); waiting: forms of this night still waiting for you;
// again: the yes was to fill the opened jobs again; confirmed: the yes was given. -> {send: jobs} | {ask: {again, jobs, replaces}} | {nothing: true}
export function fillNowPlan({tonight = [], opened = [], waiting = 0, again = false, confirmed = false}) {
  const list = again ? opened : tonight;
  if (!list.length) return !again && opened.length ? {ask: {again: true, jobs: opened, replaces: waiting}} : {nothing: true};
  if (!confirmed && (again || waiting)) return {ask: {again, jobs: list, replaces: waiting}};
  return {send: list};
}

// How many filled forms of `night` still wait for you (not submitted, not Done): a new batch for the same night replaces them. rows: the site's /state.
// except: the jobs being filled again (a row's Fill again), not counted as lost.
export const waitingOn = (rows, night, except = []) => (rows?.batch?.night === night
  ? (rows.jobs || []).filter(job => !job.cleared_at && !job.submitted_at && ['prepared', 'partial'].includes(job.state) && !except.includes(job.job)).length : 0);
