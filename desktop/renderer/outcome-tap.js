// The "How did it go?" choices on a job's menu: which outcomes make sense for the stage it is at (desktop/lib/outcomes.js writes them).
const WAITING = new Set(['Applied', 'Confirmation received']);
const TALKING = new Set(['Screening', 'Interview scheduled', 'Interviewing']);
const NOTE = 'Recorded in Notion. If Technical reports are on, counted anonymously by job board and days only: never the company or the role.';

export function outcomeChoices(stage) {
  const all = {
    reply: {outcome: 'reply', icon: 'chat', label: 'Heard back: a reply', title: `They replied. ${NOTE}`},
    screening: {outcome: 'screening', icon: 'calendar', label: 'Heard back: a call or interview is booked', title: `A call or interview is scheduled. ${NOTE}`},
    offer: {outcome: 'offer', icon: 'check', label: 'Heard back: an offer', title: `You got an offer. ${NOTE}`},
    rejected: {outcome: 'rejected', icon: 'close', label: 'Heard back: rejected', title: `They said no. ${NOTE}`},
    no_response: {outcome: 'no_response', icon: 'clock', label: 'No answer: close it', title: `Nothing came back. ${NOTE}`},
  };
  if (WAITING.has(stage)) return [all.reply, all.screening, all.offer, all.rejected, all.no_response];
  if (TALKING.has(stage)) return [all.offer, all.rejected];
  return [];
}
