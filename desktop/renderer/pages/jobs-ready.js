// The Jobs list's "Ready to submit" mark (owner, 19 Oct 2026: "how can we distinguish the jobs that are already ready to submit, filled on the server?"): which jobs
// the night filled and left complete, from the one rule the Ready card uses too (ready-rows.js readyToSubmit). The codes come from the app (readyCodes); the list marks
// its jobs with `ready`, a rerender follows when the set changed. Guard: test/ready-to-submit.test.js.
let known = new Set();

// Marks the jobs (a fresh list from the store) with the codes known so far.
export function markReady(jobs) {
  for (const job of jobs || []) job.ready = !!job.code && known.has(job.code);
}

// Asks the app which forms are ready; calls `changed` when the set is not the one the list was marked with.
export async function refreshReady(jobs, changed = () => {}) {
  const answer = await window.pilot.readyCodes?.().catch(() => null);
  if (!answer?.ok) return;
  const next = new Set(answer.codes || []);
  const same = next.size === known.size && [...next].every(code => known.has(code));
  known = next;
  if (same) return;
  markReady(jobs);
  changed();
}
