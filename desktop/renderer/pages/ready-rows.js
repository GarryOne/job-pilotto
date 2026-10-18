// The Ready to send card's words for a form's result, apart from the page (no DOM, so a test can import it): what the site counted -> the text and tone of the row. Guard: test/ready-site.test.js.
const WORDS = {prepared: ['complete', 'good'], partial: ['needs you', 'warn'], wall: ['a wall', 'warn'], 'no-form': ['no form found', 'neutral'], closed: ['job closed', 'neutral'], failed: ['could not fill', 'bad'], queued: ['waiting', 'info'],
  filling: ['filling', 'info'], stopped: ['stopped', 'neutral']};

// The one rule for "ready to submit" (owner, 19 Oct 2026): a form the night filled completely and you have not submitted or deleted. The card's count, the Jobs list's chip,
// filter and button all read it. Guard: test/ready-to-submit.test.js.
export const READY_LABEL = 'Ready to submit';
export const readyToSubmit = row => !!row && row.state === 'prepared' && !row.cleared_at && !row.submitted_at;

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

// A form the night still works on (owner, 18 Oct 2026: "2 rows, 2 progress bars", "a line with live updates from each row"): its badge, its live line and how far it is,
// from the step the container reported (site src/ready-line.js STEPS). null for a form that has its result, or when its night is not running.
// pending: the app just sent it (a row's Fill again) and the site has not shown it yet.
const STEP = {opening: ["Opening the job's page", 15], form: ['Page open: starting the fill', 30], filling: ['Filling the form', 55],
  answering: [n => `Answering ${n} question${n === 1 ? '' : 's'} with AI`, 70], reading: ['Reading what was filled', 90]};
export function liveOf(job, nightState, pending = false) {
  if (pending) return {badge: 'sending', tone: 'info', line: 'Sending it to the server', percent: 2, since: 0};
  if (!['queued', 'running'].includes(nightState) || !['queued', 'filling'].includes(job.state)) return null;
  if (job.state === 'queued') return {badge: 'waiting', tone: 'neutral', line: 'Waiting its turn: forms fill one after another', percent: 3, since: 0};
  const [words, percent] = STEP[job.step] || ['Starting the fill', 8];
  return {badge: 'filling', tone: 'info', line: typeof words === 'function' ? words(job.step_n || 0) : words, percent, since: Date.parse(job.started_at || '') || 0};
}
