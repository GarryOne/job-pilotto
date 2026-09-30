// Log job activity, step 2 (the confirmation): nothing reaches Notion until you've confirmed what Claude couldn't
// see. Each field from the engine (src/ai/inbox.py fields()) is "ok" (shown in the message: pre-filled), "check"
// (inferred: pre-filled, marked, needs a confirm) or "ask" (not shown: empty, with a question). No window needed
// (test/lead-confirm.test.js); pages/jobs.js draws it.
export const CHANNELS = ['LinkedIn', 'Email', 'Phone', 'Other'];
export const CHANNEL_LABEL = {LinkedIn: 'LinkedIn', Email: 'Email', Phone: 'Phone / call', Other: 'Other'};
// "Update on this job" (src/ai/inbox.py UPDATE): the default for a job already tracked when the message has nothing of
// its own kind (the same recruiter's chat again): its gaps, its description and who wrote last are saved.
export const KIND_LABEL = {'Update on this job': 'Update on this job (already tracked)', 'Recruiter outreach': 'First contact (a recruiter or employer pitches a role)',
  Applied: 'I applied', 'Confirmation received': 'Application received (automatic)', 'Reply received': 'A reply (no fixed time)',
  'Interview scheduled': 'A call or interview booked', Rejected: 'Rejected', Offer: 'Offer', 'Feedback received': 'Feedback'};
// Applications "Source" when this contact is where the job started (src/ai/opportunity.py CHANNEL_SOURCE).
const SOURCE = {LinkedIn: 'LinkedIn', Email: 'Gmail', Phone: 'Phone'};
const ORDER = ['kind', 'channel', 'started', 'interview', 'last', 'company', 'agency'];

// The form's starting state: values as read, "ok" fields already confirmed; first contact: yes for a new job.
export function initial(proposal = {}) {
  const fields = proposal.fields || {};
  const values = Object.fromEntries(Object.entries(fields).filter(([, field]) => field).map(([name, field]) => [name, field.value || '']));
  const confirmed = Object.keys(fields).filter(name => fields[name]?.state === 'ok');
  return {values, confirmed, other: '', first: proposal.new ? 'yes' : ''};
}

// A value changed (or "Looks right" pressed): that field is confirmed.
export function set(state, name, value) {
  return {...state, values: value === undefined ? state.values : {...state.values, [name]: value},
    confirmed: state.confirmed.includes(name) ? state.confirmed : [...state.confirmed, name]};
}

const required = (proposal, state, name) => {
  const field = proposal.fields?.[name];
  if (!field) return false;
  if (name === 'interview') return state.values.kind === 'Interview scheduled';  // follows the kind you chose
  return field.required !== false;
};

// What still needs you before saving: [{name, why}] ("check" = inferred, confirm it; "empty" = required, not given).
export function pending(proposal = {}, state, today = '') {
  const out = [];
  for (const name of ORDER) {
    const field = proposal.fields?.[name];
    if (!field) continue;
    const value = state.values[name];
    if (required(proposal, state, name) && !value) out.push({name, why: 'empty'});
    else if (field.state === 'check' && !state.confirmed.includes(name)) out.push({name, why: 'check'});
    else if ((name === 'started' || name === 'last') && today && value > today) out.push({name, why: 'future'});
  }
  return out;
}

// The Save button's words: what's left, or the save itself.
export function saveLabel(left) {
  return left.length ? `Confirm ${left.length} detail${left.length === 1 ? '' : 's'}` : 'Save to Notion';
}

// "Which year was this ("Sep 21")?" → the date for a year picked (month_day "09-21").
export function withYear(field, year) { return `${year}-${field.month_day}`; }

export function channelHint(field = {}, chosen) {
  const guess = field.guess;
  if (field.state === 'ok') return chosen === guess ? `Shown in the message: ${guess}.` : `The message showed ${guess}; saved as ${CHANNEL_LABEL[chosen] || chosen}.`;
  if (!guess || guess === 'Other') return chosen === 'Other' ? 'Say where, e.g. WhatsApp (optional).' : "Couldn't tell from the message: pick one.";
  if (chosen === guess) return `Looks like ${guess} — change it if not.`;
  return `Claude guessed ${guess}; saved as ${CHANNEL_LABEL[chosen] || chosen}.`;
}

export function startedHint(isNew) {
  return isNew ? 'The date of the first message in this conversation.'
    : "Earlier than this job's first contact? Then this conversation becomes where it started (its Source).";
}

// Who wrote last (src/ai/inbox.py fields() 'last'): what saving it does for Focus, and what they wrote.
export function lastHint(field = {}, value = '') {
  const said = field.snippet ? ` "${field.snippet.length > 60 ? `${field.snippet.slice(0, 59)}…` : field.snippet}"` : '';
  const what = field.from === 'you' ? `You wrote last${said}: Focus reminds you to follow up after 24 hours without an answer.`
    : `They wrote last${said}: Focus shows it as waiting for your answer.`;
  if (field.state === 'ask' && !value) return `Couldn't read the day${field.as_written ? ` ("${field.as_written}")` : ''}. Leave it empty if you don't know: then nothing is saved about it.`;
  return what;
}

export function firstHint(channel, first, other = '') {
  if (first === 'no') return 'Its Source stays how you added it; this is logged as a later contact.';
  const source = SOURCE[channel];
  return source ? `The job's Source will be ${source}.` : `The job's Source will be how you added it${other ? ` (${other} noted)` : ''}.`;
}

// The bold line and the muted line under it: what was read and what saving will do.
export function found(proposal = {}) {
  const meta = proposal.new ? 'New job: added to Notion when you save'
    : `Already tracked${proposal.stage ? ` (${proposal.stage})` : ''}: updated when you save`;
  return {title: proposal.label || 'The job', meta};
}

// What goes to the engine (src/daily.py --kind, --channel, --started, --interview-at, --company, --agency,
// --first-contact). firstContact: null for a job already tracked (the earliest-contact rule decides its Source).
export function confirmed(proposal = {}, state) {
  const v = state.values, has = name => !!proposal.fields?.[name];
  return {kind: v.kind, channel: v.channel, other: v.channel === 'Other' ? String(state.other || '').trim().slice(0, 40) : '',
    started: v.started, interview: has('interview') ? v.interview || '' : '', ...(has('last') ? {lastAt: v.last || ''} : {}),
    ...(has('company') ? {company: String(v.company || '').trim()} : {}), ...(has('agency') ? {agency: String(v.agency || '').trim()} : {}),
    firstContact: proposal.new ? state.first !== 'no' : null};
}
