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
const ORDER = ['kind', 'channel', 'started', 'origin', 'agree', 'interview', 'last', 'company', 'agency'];
const day = value => String(value || '').slice(0, 10);

// "Who reached out first?" (src/ai/inbox.py fields() 'origin'): asked for a tracked Outbound job, but shown only once
// the day you confirmed for the conversation's start is before the job's first known contact.
export const originShown = (proposal = {}, state = {}) => {
  const field = proposal.fields?.origin;
  return !!field && !!state.values?.started && day(state.values.started) < day(field.first_known);
};

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

// A call time is asked only for a kind that can have one: not for a rejection, an application, its confirmation or feedback
// (src/ai/inbox.py NO_CALL). The time Claude read there is the message's own ("THURSDAY 8:34 AM"), so it is neither shown nor saved.
const NO_CALL = ['Rejected', 'Applied', 'Confirmation received', 'Feedback received'];
export const interviewShown = (proposal = {}, state = {}) => !!proposal.fields?.interview && !NO_CALL.includes(state.values?.kind);

const required = (proposal, state, name) => {
  const field = proposal.fields?.[name];
  if (!field) return false;
  if (name === 'interview') return state.values.kind === 'Interview scheduled';  // follows the kind you chose
  if (name === 'origin') return originShown(proposal, state);
  return field.required !== false;
};

// "Which job is this?" open: asked (Claude found no job, several are from the same recruiter or company) or you
// pressed Change. The other details follow the job you pick (proposed again for it), so they wait.
export const choosingJob = (proposal = {}, state = {}) => proposal.fields?.job?.state === 'ask' || !!state.picking;

// What still needs you before saving: [{name, why}] ("check" = inferred, confirm it; "empty" = required, not given).
export function pending(proposal = {}, state, today = '') {
  if (choosingJob(proposal, state)) return [{name: 'job', why: 'empty'}];
  const out = [];
  for (const name of ORDER) {
    const field = proposal.fields?.[name];
    if (!field || (name === 'origin' && !originShown(proposal, state)) || (name === 'interview' && !interviewShown(proposal, state))) continue;
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

// "Did you agree to talk to the recruiter?" (src/ai/inbox.py fields() 'agree'): there only for a new job or a Recruiter
// lead, pre-filled when the conversation shows your yes, asked when your reply leaves it unclear.
export function agreeHint(field = {}, value = '', isNew = false) {
  if (field.state === 'ok' && value === 'yes') return 'Confirmed from the conversation: the job moves to Screening.';
  if (value === 'yes') return 'The job moves to Screening.';
  if (value === 'no') return isNew ? 'Saved as a Recruiter lead.' : 'It stays a Recruiter lead.';
  return "Your reply doesn't say it clearly. Yes moves the job to Screening.";
}

// Under "Who reached out first?": why it is asked, and what each answer means.
const shortDay = value => { const [y, m, d] = day(value).split('-').map(Number); return y ? `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}` : ''; };
export function originHint(field = {}, state = {}) {
  const channel = CHANNEL_LABEL[state.values?.channel] || 'this channel';
  const first = `Your conversation on ${channel} (${shortDay(state.values?.started)}) came before this job's first contact (${shortDay(field.first_known)}).`;
  if (state.values?.origin === 'inbound') return `${first} Counted as inbound.`;
  if (state.values?.origin === 'outbound') return `${first} Stays in your application funnel.`;
  return `${first} If they wrote first, it counts as inbound.`;
}

// The outcomes a save always applies to a tracked job's Stage (src/ai/mail.py _stage_for: a terminal kind moves any job
// that isn't already Rejected, Withdrawn or Offer). Other kinds move a stage only forward: not promised here.
const TERMINAL_KIND = new Set(['Rejected', 'Offer']);
const TERMINAL_STAGE = new Set(['Rejected', 'Withdrawn', 'Offer']);

// "This will change": the values of a tracked job a save would replace, {name, from, to, note}: Origin (your answer),
// Source (the conversation is where it started: src/ai/opportunity.py first_contact_changes) and Stage. Never what it
// only adds (a salary, the description) and nothing for a new job.
export function changes(proposal = {}, state = {}) {
  const now = proposal.current || {}, v = state.values || {}, out = [];
  if (proposal.new || !Object.keys(now).length) return out;
  const earlier = !!v.started && !!proposal.first_known && day(v.started) < day(proposal.first_known);
  if (earlier && originShown(proposal, state) && v.origin === 'inbound' && now.Origin === 'Outbound') {
    out.push({name: 'Origin', from: 'Outbound', to: 'Inbound', note: 'Leaves your application funnel and joins the inbound funnel.'});
  }
  const source = SOURCE[v.channel], was = now.Source;
  const wasChannel = Object.keys(SOURCE).find(channel => SOURCE[channel] === was);
  if (earlier && source && was && wasChannel !== v.channel) out.push({name: 'Source', from: was, to: source, note: ''});
  if (TERMINAL_KIND.has(v.kind) && now.Stage && !TERMINAL_STAGE.has(now.Stage) && now.Stage !== v.kind) {
    out.push({name: 'Stage', from: now.Stage, to: v.kind, note: ''});
  }
  return out;
}

export function firstHint(channel, first, other = '') {
  if (first === 'no') return 'Its Source stays how you added it; this is logged as a later contact.';
  const source = SOURCE[channel];
  return source ? `The job's Source will be ${source}.` : `The job's Source will be how you added it${other ? ` (${other} noted)` : ''}.`;
}

// Step 1's "Link to job": automatic ('' , Claude finds it) while "Find the job automatically" is ticked, else the job
// you chose ('new' = not in the list yet; '' = none chosen yet).
export const targetOf = (auto, value = '') => (auto ? '' : String(value || ''));

// "Which job is this?" choices: the likely ones first (same recruiter or company), a new job, then your other jobs.
// candidates: [{url, label, stage}] from the engine; tracked: the Jobs list ({url, company, via, title, stage}).
export function jobChoices(candidates = [], tracked = []) {
  const text = job => `${job.label}${job.stage ? ` (${job.stage})` : ''}`;
  const likely = candidates.map(job => ({value: job.url, text: text(job)}));
  const seen = new Set(candidates.map(job => job.url));
  const others = tracked.filter(job => job.stage && !['Dismissed', 'Closed'].includes(job.stage) && !seen.has(job.url))
    .map(job => ({value: job.url, text: text({label: `${job.company || job.via || '—'} · ${job.title}`, stage: job.stage})}))
    .sort((a, b) => a.text.localeCompare(b.text));
  return [...(likely.length ? [{group: 'Possible matches', options: likely}] : []),
    {options: [{value: 'new', text: 'A new job (not in my list yet)'}]},
    ...(others.length ? [{group: likely.length ? 'Your other applications' : 'Your applications', options: others}] : [])];
}

export function searchJobChoices(groups, query = '') {
  const words = String(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return groups.map(({group, options}) => ({...(group ? {group} : {}),
    options: options.filter(option => words.every(word => option.text.toLocaleLowerCase().includes(word)))}))
    .filter(({options}) => options.length);
}

// The form for the job you picked, keeping what you had already confirmed (the date, the channel…); the kind only when
// the new job offers it. Whether you agreed to talk follows the job, so it's asked again when it applies.
export function carry(state = {}, next = {}) {
  let out = initial(next);
  for (const name of state.confirmed || []) {
    if (['job', 'agree'].includes(name) || !next.fields?.[name] || next.fields[name].state === 'ok') continue;
    if (name === 'kind' && next.fields.kind.options && !next.fields.kind.options.includes(state.values.kind)) continue;
    out = set(out, name, state.values[name]);
  }
  return {...out, other: state.other || '', first: next.new ? state.first || 'yes' : ''};
}

// The bold line and the muted line under it: what was read and what saving will do.
export function found(proposal = {}) {
  const meta = proposal.new ? 'New job: added to Notion when you save'
    : `Already tracked${proposal.stage ? ` (${proposal.stage})` : ''}: updated when you save`;
  return {title: proposal.label || 'The job', meta};
}

// What goes to the engine (src/daily.py --kind, --channel, --started, --interview-at, --company, --agency,
// --first-contact, --agreed, --origin). firstContact: null for a job already tracked (the earliest-contact rule decides its Source);
// agreed only when the question was there.
export function confirmed(proposal = {}, state) {
  const v = state.values, has = name => !!proposal.fields?.[name];
  return {kind: v.kind, channel: v.channel, other: v.channel === 'Other' ? String(state.other || '').trim().slice(0, 40) : '',
    started: v.started, interview: interviewShown(proposal, state) ? v.interview || '' : '', ...(has('last') ? {lastAt: v.last || ''} : {}),
    ...(has('company') ? {company: String(v.company || '').trim()} : {}), ...(has('agency') ? {agency: String(v.agency || '').trim()} : {}),
    firstContact: proposal.new ? state.first !== 'no' : null, ...(has('agree') ? {agreed: v.agree === 'yes'} : {}),
    ...(originShown(proposal, state) ? {origin: v.origin} : {})};
}

// The Log box's live steps (the engine's "⏳" lines, pipeline.js leadStepOf): the finished ones with how long each took, the current one last.
// A "Waiting for …" line replaces the one before it (its minutes tick up), so a long wait stays one row.
export const WAITING = /^Waiting for /;
export function addStep(steps, text, at) {
  const last = steps.at(-1);
  if (last?.text === text) return steps;
  if (last && WAITING.test(last.text) && WAITING.test(text)) return [...steps.slice(0, -1), {text, at: last.at}];  // one wait, timed from its start
  return [...steps, {text, at}];
}
export function stepRows(steps, now, keep = 6) {
  const from = Math.max(0, steps.length - keep);
  return steps.slice(from).map((step, i) => {
    const next = steps[from + i + 1];
    return {text: step.text, now: !next, seconds: Math.round(((next ? next.at : now) - step.at) / 1000)};
  });
}
