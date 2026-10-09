// The "How did it go?" choices on a job's menu: which outcomes make sense for the stage it is at (desktop/lib/outcomes.js writes them).
const WAITING = new Set(['Applied', 'Confirmation received']);
const TALKING = new Set(['Screening', 'Interview scheduled', 'Interviewing']);
// where: the store's name (renderer/store-words.js storeName(), passed in: this module stays free of the window's state for its tests).
const note = where => `Recorded in ${where}. If Technical reports are on, counted anonymously by job board and days only: never the company or the role.`;

export function outcomeChoices(stage, where = 'your data') {
  const all = {
    reply: {outcome: 'reply', icon: 'chat', label: 'Heard back: a reply', title: `They replied. ${note(where)}`},
    screening: {outcome: 'screening', icon: 'calendar', label: 'Heard back: a call or interview is booked', title: `A call or interview is scheduled. ${note(where)}`},
    offer: {outcome: 'offer', icon: 'check', label: 'Heard back: an offer', title: `You got an offer. ${note(where)}`},
    rejected: {outcome: 'rejected', icon: 'close', label: 'Heard back: rejected', title: `They said no. ${note(where)}`},
    no_response: {outcome: 'no_response', icon: 'clock', label: 'No answer: close it', title: `Nothing came back. ${note(where)}`},
  };
  if (WAITING.has(stage)) return [all.reply, all.screening, all.offer, all.rejected, all.no_response];
  if (TALKING.has(stage)) return [all.offer, all.rejected];
  return [];
}
