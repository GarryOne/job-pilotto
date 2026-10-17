// The Ready to send card's words for a form's result, apart from the page (no DOM, so a test can import it): what the site counted -> the text and tone of the row. Guard: test/ready-site.test.js.
const WORDS = {prepared: ['complete', 'good'], partial: ['needs you', 'warn'], wall: ['a wall', 'warn'], 'no-form': ['no form found', 'neutral'], failed: ['could not fill', 'bad'], queued: ['waiting', 'info']};

export function rowOf(job) {
  const [text, tone] = WORDS[job.state] || ['waiting', 'info'];
  const left = job.state === 'partial' && job.left_empty ? ` · ${job.left_empty} left` : '';
  const wall = ['wall', 'failed'].includes(job.state) && job.wall && job.wall !== 'error' ? ` · ${job.wall}` : '';   // a failed night says why ("the night could not start")
  return {text: `${text}${left}${wall}`, tone, done: !!job.cleared_at, submitted: !!job.submitted_at};
}

// The morning line: how many forms wait for you (filled, not yet submitted or deleted), and how many of them still need you. null when none.
export function waitingOf(jobs) {
  const open = jobs.filter(job => !job.cleared_at && !job.submitted_at && ['prepared', 'partial'].includes(job.state));
  return open.length ? {ready: open.length, left: open.filter(job => job.state === 'partial').length} : null;
}
