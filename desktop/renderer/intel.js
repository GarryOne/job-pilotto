// What a job's fit score and what became of it look like to the product, as counts (src/intelligence.js on the site): the score bands, the states,
// the one-tap dismiss reasons and the daily snapshot. Pure: jobs in, counts out. Nothing here carries a title, a company or a link.
export const REASONS = [
  {id: 'seniority', label: 'Wrong seniority'}, {id: 'location', label: 'Wrong location'}, {id: 'tech', label: 'Not my tech'},
  {id: 'company', label: 'Company'}, {id: 'role', label: 'Not my kind of role'}, {id: 'other', label: 'Other'},
];

export function scoreBucket(score) {
  const value = Number(score);
  if (score == null || score === '' || !Number.isFinite(value)) return 'unscored';
  return value < 40 ? '0-39' : value < 60 ? '40-59' : value < 80 ? '60-79' : '80-100';
}

const STAGE_STATE = {Applying: 'applying', Applied: 'applied', 'Confirmation received': 'applied', Screening: 'screening', 'Interview scheduled': 'screening',
  Interviewing: 'interviewing', Offer: 'offer', Rejected: 'rejected', 'No response': 'no_response', Withdrawn: 'withdrawn'};

// Where a job stands: not yet acted on (new), saved, dismissed, or how far an application got.
export function jobState(job) {
  if (STAGE_STATE[job?.stage]) return STAGE_STATE[job.stage];
  if (job?.status === 'applied') return 'applied';
  if (job?.status === 'saved') return 'saved';
  if (job?.status === 'dismissed') return 'dismissed';
  return 'new';
}

// [{bucket, state, n}] for every job that has a state: the whole list in at most 55 numbers.
export function snapshot(jobs) {
  const counts = new Map();
  for (const job of Array.isArray(jobs) ? jobs : []) {
    const key = `${scoreBucket(job?.fit)}|${jobState(job)}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts].map(([key, n]) => { const [bucket, state] = key.split('|'); return {bucket, state, n}; });
}

// Per host of the job's address: jobs seen, acted on, dismissed, heard back. The app folds the hosts into job-board kinds and drops the rest.
export function hostStats(jobs) {
  const hosts = new Map();
  for (const job of Array.isArray(jobs) ? jobs : []) {
    let host = '';
    try { host = new URL(String(job?.url)).hostname; } catch { continue; }
    const state = jobState(job), entry = hosts.get(host) || {host, seen: 0, acted: 0, dismissed: 0, heard: 0};
    entry.seen++;
    if (state === 'dismissed') entry.dismissed++;
    else if (state !== 'new') entry.acted++;
    if (['screening', 'interviewing', 'offer'].includes(state)) entry.heard++;
    hosts.set(host, entry);
  }
  return [...hosts.values()];
}
