// Interview reminders and job matching (pure; the timer and notifications are in main.js). The jobs come from Notion
// (Applications → Next interview, filled by the Gmail and Calendar check). A Mac notification comes 10 and 1 minute
// before an interview so the recording gets started, and a recording is matched to the job whose interview time is close
// to when it began. It only ever suggests: the job is confirmed by saving, and the consent box stays the user's tick.
export const MINUTES = [10, 1];
export const MATCH_WINDOW_MIN = 45;   // a recording starting this close to an interview's time belongs to it (likely)
const MIN = 60000;

export const on = storage => storage.settings().interviewReminders !== false;

const when = job => { const t = Date.parse(job?.next_interview || ''); return Number.isFinite(t) ? t : null; };
export const keyOf = job => `${job.page_id || job.url}|${job.next_interview}`;

// Interviews still ahead (or begun in the last few minutes).
export function upcoming(jobs = [], now = Date.now()) {
  return jobs.filter(job => when(job) != null && when(job) > now - 5 * MIN && !['rejected', 'dismissed'].includes(job.status))
    .sort((a, b) => when(a) - when(b));
}

// The reminders to show now: one per interview per window that has been reached and not sent. If the app was closed and
// several windows were missed, one reminder is shown (with the minutes really left) and the earlier windows count as sent.
export function due(jobs, sent = {}, now = Date.now(), minutes = MINUTES) {
  const out = [];
  for (const job of upcoming(jobs, now)) {
    const left = (when(job) - now) / MIN;
    const reached = minutes.filter(m => left <= m && !sent[`${keyOf(job)}|${m}`]);
    if (!reached.length || left < -5) continue;
    out.push({job, keys: reached.map(m => `${keyOf(job)}|${m}`), minutes: Math.max(0, Math.round(left))});
  }
  return out;
}

export function text(item) {
  const job = item.job;
  const who = job.company || job.title || 'your interview';
  const time = item.minutes <= 0 ? 'starts now' : item.minutes === 1 ? 'starts in 1 minute' : `starts in ${item.minutes} minutes`;
  return {title: `Interview with ${who} ${time}`, body: `${job.title ? `${job.title}. ` : ''}Open Interviews to start the recording (tick that everyone agreed).`};
}

// The job an interview at `at` (a recording's start) belongs to: the closest Next interview within the window, if it is clearly
// the closest (two jobs within 15 minutes of each other are ambiguous and give no suggestion).
export function match(jobs = [], at = Date.now(), windowMin = MATCH_WINDOW_MIN) {
  const close = jobs.map(job => ({job, gap: when(job) == null ? Infinity : Math.abs(when(job) - at) / MIN}))
    .filter(item => item.gap <= windowMin).sort((a, b) => a.gap - b.gap);
  if (!close.length) return null;
  if (close[1] && close[1].gap - close[0].gap < 15 && close[1].job.url !== close[0].job.url) return null;
  return close[0].job;
}
