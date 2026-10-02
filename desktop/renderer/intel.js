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
