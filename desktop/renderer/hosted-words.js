// The words and states of Always on "on our servers" (owner, 17 Oct 2026: one name everywhere; ON by default for a trial install until it presses Skip). Pure: renderer/pages/hosted.js draws it.
// States: on with an e-mail, on without one (asks for it first), off (Skip or turned off), paused (14 days idle, budget, limit), trial over. Guard: test/hosted-words.test.js.
export const NAME = 'Always on: on our servers';
export const SUBTITLE = 'New matches every morning, even when your Mac is off';
export const STORED = 'Your profile is stored encrypted on our servers. Turn it off anytime = deleted.';
export const NEWS = 'Also send me product news and the Pro launch offer (unsubscribe in one click)';
// Demo jobs only, always marked "Example": the person sees what arrives, never a claim about their own matches.
export const EXAMPLE_JOBS = [['Platform Engineer · Zurich', '86'], ['Cloud Engineer · Remote, EU', '81'], ['Site Reliability Engineer · Berlin', '78']];

export const NEWS_HINT = 'Separate from your matches.';
export const HELPER = 'We send the daily matches here. Unsubscribe in one click.';

const two = n => String(n).padStart(2, '0');
// "today ~7:00" / "tomorrow ~7:00" / "Mon ~7:00" in the person's own time.
export function when(iso, now = new Date()) {
  const at = new Date(iso);
  if (!(at.getTime() > 0)) return '';
  const day = d => Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86400000);
  const gap = day(at) - day(now), clock = `${at.getHours()}:${two(at.getMinutes())}`;
  return `${gap <= 0 ? 'today' : gap === 1 ? 'tomorrow' : at.toLocaleDateString('en', {weekday: 'short'})} ~${clock}`;
}

// -> {state, pill: [text, tone], line, asksEmail, button: 'on' | 'resume' | 'save' | null, off, download, note}
//   mine: the app's own record {on, skipped, email}; schedule: the server's {state, pause_reason, next_run_at, email_channel} or null.
export function model(mine = {}, schedule = null, now = new Date()) {
  const email = mine.email || '', skipped = !!mine.skipped && !mine.on;
  if (skipped) return {state: 'off', pill: ['Off', 'neutral'], line: 'Turn it on to get new matches every morning, even when your Mac is off.', asksEmail: true, button: 'on', off: false, download: false};
  if (!mine.on || !email) return {state: 'needs-email', pill: ['On', 'good'], line: 'Add your email to get the matches. Searches start as soon as you do.', asksEmail: true, button: 'save', off: false, download: false};
  if (schedule?.state === 'paused') {
    const why = {
      'inactive': ['Paused: you have not opened Jobadabra for 14 days. Resume to get matches again.', 'resume'],
      'trial-over': ['Your free trial is over. Get Pro to keep Always on running.', null],
      'budget': ['Paused: the free AI in your trial is used up. Get Pro to keep Always on running.', null],
      'guard': ['Paused: it reached this month\'s limit. It continues next month.', null],
    }[schedule.pause_reason] || ['Paused. Resume to get matches again.', 'resume'];
    return {state: `paused-${schedule.pause_reason || 'other'}`, pill: ['Paused', 'warn'], line: why[0], asksEmail: false, button: why[1], off: true, download: true};
  }
  const next = schedule?.next_run_at ? ` Next search: ${when(schedule.next_run_at, now)}.` : '';
  const mail = schedule && schedule.email_channel === 0 ? ' E-mail is off for this address; matches still appear here.' : '';
  return {state: 'on', pill: ['On', 'good'], line: `Searches every day and e-mails ${email}.${next}${mail}`, asksEmail: false, button: null, off: true, download: true};
}
