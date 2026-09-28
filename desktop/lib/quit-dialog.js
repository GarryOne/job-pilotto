// The words of the "you're quitting while something works" dialogs (native macOS/Windows dialogs: a title, a few
// lines, buttons). Short, one line per thing that would stop, and what happens to it.
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const SHOWN = 4;

// "• N26" per session (the company: the job title is long and the list only has to be recognised), then "+ 2 more".
export function sessionLines(sessions, label) {
  const lines = sessions.slice(0, SHOWN).map(session => `•  ${label(session)}`);
  if (sessions.length > SHOWN) lines.push(`•  and ${sessions.length - SHOWN} more`);
  return lines;
}

const AFTER = 'Filled forms stay in Chrome. After restarting, press Resume Claude in Application sessions.';

// Only Claude sessions are working (the queue is empty): keep them, or stop them and quit.
export function sessionsOnly(sessions, label) {
  const one = sessions.length === 1;
  return {
    message: one ? 'Claude is still filling an application' : `Claude is still filling ${sessions.length} applications`,
    detail: `${sessionLines(sessions, label).join('\n')}\n\nQuitting stops ${one ? 'it' : 'them'} where ${one ? 'it is' : 'they are'}. ${AFTER}`,
    buttons: ['Keep working', 'Stop and quit'],
  };
}

// Searches, queued jobs and/or sessions: quit when they finish, quit now, or stay.
export function working({busy = null, queue = [], sessions = [], taskName, label}) {
  const lines = [];
  if (busy) lines.push(`•  ${taskName(busy.kind)} is running`);
  if (queue.length) lines.push(`•  ${plural(queue.length, 'task', 'tasks')} waiting: ${queue.map(job => taskName(job.kind)).join(', ')}`);
  if (sessions.length) lines.push(`•  Claude is filling ${plural(sessions.length, 'application', 'applications')}: ${sessions.slice(0, SHOWN).map(label).join(', ')}${sessions.length > SHOWN ? '…' : ''}`);
  return {
    message: 'Job Pilotto is still working',
    detail: `${lines.join('\n')}\n\nQuit when done: closes by itself once these finish.\n` +
      `Quit now: stops them, and the jobs you started run again next time. What's saved stays in Notion.` +
      (sessions.length ? `\n\n${AFTER}` : ''),
    buttons: ['Quit when done', 'Quit now', 'Cancel'],
  };
}
