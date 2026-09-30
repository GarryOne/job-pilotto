// Log job activity's confirmation step: nothing is saved until what Claude couldn't see is confirmed.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as lead from '../renderer/lead-confirm.js';

// The 30 Sep 2026 bug: a LinkedIn chat screenshot without a year ("Sep 21"), a call "Friday at 3pm" mentioned.
const chat = {new: true, label: 'Example Robotics — Senior SRE', kind: 'Interview scheduled', fields: {
  kind: {value: 'Interview scheduled', state: 'check'},
  channel: {value: 'LinkedIn', state: 'ok', guess: 'LinkedIn'},
  started: {value: '', state: 'ask', month_day: '09-21', years: [2026, 2025], question: 'Which year was "Sep 21"?'},
  interview: {value: '', state: 'ask', required: true, question: 'When is the call?', as_written: 'Friday at 3pm'},
  company: {value: 'Example Robotics', state: 'check', required: false},
  agency: {value: 'Example Talent', state: 'ok', required: false}}};

test('a date without its year is asked, never assumed; inferred values wait for a confirm', () => {
  let state = lead.initial(chat);
  assert.equal(state.values.started, '');
  assert.deepEqual(lead.pending(chat, state).map(p => `${p.name}:${p.why}`),
    ['kind:check', 'started:empty', 'interview:empty', 'company:check']);
  assert.equal(lead.saveLabel(lead.pending(chat, state)), 'Confirm 4 details');
  state = lead.set(state, 'started', lead.withYear(chat.fields.started, 2026));
  state = lead.set(state, 'kind', 'Reply received');  // not booked after all: the call time is no longer required
  state = lead.set(state, 'company');  // "Looks right"
  assert.deepEqual(lead.pending(chat, state), []);
  assert.equal(lead.saveLabel([]), 'Save to Notion');
  assert.deepEqual(lead.confirmed(chat, state), {kind: 'Reply received', channel: 'LinkedIn', other: '', started: '2026-09-21',
    interview: '', company: 'Example Robotics', agency: 'Example Talent', firstContact: true});
});

test('a booked call needs its time; a start date is never in the future', () => {
  let state = lead.set(lead.set(lead.set(lead.initial(chat), 'kind'), 'company'), 'started', '2026-10-02');
  assert.deepEqual(lead.pending(chat, state, '2026-09-30').map(p => p.name), ['started', 'interview']);
  state = lead.set(lead.set(state, 'interview', '2026-10-03T15:00'), 'started', '2026-09-21');
  assert.deepEqual(lead.pending(chat, state, '2026-09-30'), []);
});

test('a tracked job leaves Source to the earliest-contact rule; Other says where', () => {
  const tracked = {...chat, new: false, fields: {...chat.fields, company: undefined, agency: undefined}};
  const state = lead.set(lead.initial(tracked), 'channel', 'Other');
  assert.equal(lead.confirmed(tracked, {...state, other: ' WhatsApp '}).firstContact, null);
  assert.equal(lead.confirmed(tracked, {...state, other: ' WhatsApp '}).other, 'WhatsApp');
  assert.equal(lead.firstHint('Email', 'yes'), "The job's Source will be Gmail.");
  assert.match(lead.startedHint(false), /earlier than this job's first contact/i);
});

test('the channel hint says whether it was shown or guessed', () => {
  assert.equal(lead.channelHint({state: 'check', guess: 'LinkedIn'}, 'LinkedIn'), 'Looks like LinkedIn — change it if not.');
  assert.equal(lead.channelHint({state: 'check', guess: 'LinkedIn'}, 'Email'), 'Claude guessed LinkedIn; saved as Email.');
  assert.match(lead.channelHint({state: 'ask', guess: ''}, ''), /Couldn't tell/);
  assert.equal(lead.channelHint({state: 'ok', guess: 'LinkedIn'}, 'LinkedIn'), 'Shown in the message: LinkedIn.');
});

test('your answers reach the engine as flags; company "" means not named', async () => {
  const {confirmedArgs} = await import('../lib/pipeline.js');
  assert.deepEqual(confirmedArgs({kind: 'Reply received', channel: 'Other', other: 'WhatsApp', started: '2026-09-21', interview: '',
    company: '', agency: 'Example Talent', firstContact: false}),
  ['--kind', 'Reply received', '--channel', 'Other', '--channel-other', 'WhatsApp', '--started', '2026-09-21',
    '--company', '', '--agency', 'Example Talent', '--first-contact', 'no']);
  assert.deepEqual(confirmedArgs({channel: 'LinkedIn', started: '2026-09-21', firstContact: null}),
    ['--channel', 'LinkedIn', '--started', '2026-09-21']);
});

// The 30 Sep 2026 Duvo.ai case: a job already tracked (Screening); the chat's MONDAY divider was readable.
const tracked = {new: false, stage: 'Screening', label: 'Duvo.ai — Senior SRE', kind: 'Update on this job', fields: {
  kind: {value: 'Update on this job', state: 'ok', options: ['Update on this job', 'Recruiter outreach', 'Reply received']},
  channel: {value: 'LinkedIn', state: 'ok', guess: 'LinkedIn'},
  started: {value: '2026-09-28', state: 'ok', as_written: 'MONDAY 12:33 AM'},
  last: {value: '2026-09-28', state: 'ok', required: false, from: 'you', snippet: 'Hi Márton, thanks for reaching out!',
    as_written: 'MONDAY 10:05 AM', question: 'When was the last message?'}}};

test('a tracked job defaults to "Update on this job", unmarked; nothing about dates is asked when MONDAY was readable', () => {
  const state = lead.initial(tracked);
  assert.equal(state.values.kind, 'Update on this job');
  assert.deepEqual(lead.pending(tracked, state, '2026-09-30'), []);
  assert.equal(lead.KIND_LABEL['Update on this job'], 'Update on this job (already tracked)');
  assert.equal(lead.confirmed(tracked, state).lastAt, '2026-09-28');
  assert.match(lead.lastHint(tracked.fields.last, '2026-09-28'), /^You wrote last "Hi Márton, thanks for reaching out!": Focus reminds you to follow up after 24 hours/);
});

test('an unreadable last day is asked but never required; empty saves nothing about it', () => {
  const asked = {...tracked, fields: {...tracked.fields, last: {...tracked.fields.last, value: '', state: 'ask', as_written: '10:05 AM'}}};
  let state = lead.initial(asked);
  assert.deepEqual(lead.pending(asked, state, '2026-09-30'), []);
  assert.match(lead.lastHint(asked.fields.last, ''), /Couldn't read the day \("10:05 AM"\)\. Leave it empty/);
  assert.equal(lead.confirmed(asked, state).lastAt, '');
  state = lead.set(state, 'last', '2026-10-02');
  assert.deepEqual(lead.pending(asked, state, '2026-09-30'), [{name: 'last', why: 'future'}]);
});

test('the last day reaches the engine as --last-at', async () => {
  const {confirmedArgs} = await import('../lib/pipeline.js');
  assert.deepEqual(confirmedArgs({kind: 'Update on this job', lastAt: '2026-09-28', firstContact: null}),
    ['--kind', 'Update on this job', '--last-at', '2026-09-28']);
});

// Did you agree to talk to the recruiter? Read from the conversation (src/ai/inbox.py seen.agreement); the first form
// has no checkbox, and the confirmation step asks only when your reply leaves it unclear.
const pitch = {...chat, kind: 'Recruiter outreach', fields: {...chat.fields, kind: {value: 'Recruiter outreach', state: 'ok'},
  started: {value: '2026-09-21', state: 'ok'}, interview: undefined, company: {value: 'Example Robotics', state: 'ok', required: false}}};

test('an unclear reply asks "Did you agree to talk?"; nothing is saved before it is answered', () => {
  const unclear = {...pitch, fields: {...pitch.fields, agree: {value: '', state: 'ask', question: 'Did you agree to talk to the recruiter?'}}};
  let state = lead.initial(unclear);
  assert.deepEqual(lead.pending(unclear, state), [{name: 'agree', why: 'empty'}]);
  assert.match(lead.agreeHint(unclear.fields.agree, ''), /Yes moves the job to Screening/);
  state = lead.set(state, 'agree', 'no');
  assert.deepEqual(lead.pending(unclear, state), []);
  assert.equal(lead.confirmed(unclear, state).agreed, false);
  assert.equal(lead.agreeHint(unclear.fields.agree, 'no', true), 'Saved as a Recruiter lead.');
  assert.equal(lead.confirmed(unclear, lead.set(state, 'agree', 'yes')).agreed, true);
});

test('a yes shown in the conversation is pre-filled and marked as confirmed from it; no question otherwise', () => {
  const shown = {...pitch, fields: {...pitch.fields, agree: {value: 'yes', state: 'ok', question: 'Did you agree to talk to the recruiter?'}}};
  const state = lead.initial(shown);
  assert.deepEqual(lead.pending(shown, state), []);
  assert.equal(lead.agreeHint(shown.fields.agree, 'yes'), 'Confirmed from the conversation: the job moves to Screening.');
  assert.equal(lead.confirmed(shown, state).agreed, true);
  assert.ok(!('agreed' in lead.confirmed(pitch, lead.initial(pitch))));  // none / declined / another job: not asked, not sent
});

test('the answer reaches the engine as --agreed', async () => {
  const {confirmedArgs} = await import('../lib/pipeline.js');
  assert.deepEqual(confirmedArgs({channel: 'LinkedIn', agreed: true}), ['--channel', 'LinkedIn', '--agreed', 'yes']);
  assert.deepEqual(confirmedArgs({channel: 'LinkedIn', agreed: false}), ['--channel', 'LinkedIn', '--agreed', 'no']);
});

test('the first form has no "I agreed" checkbox; the question lives in the confirmation step', async () => {
  const fs = await import('node:fs');
  const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
  const compose = html.slice(html.indexOf('<div id="lead-compose">'), html.indexOf('<div id="lead-confirm"'));
  assert.doesNotMatch(compose, /lead-talking|agreed/i);
  const confirm = html.slice(html.indexOf('<div id="lead-confirm"'), html.indexOf('id="lead-message"'));
  assert.match(confirm, /data-field="agree"[\s\S]*Did you agree to talk to the recruiter\?[\s\S]*data-agree="yes">Yes<[\s\S]*data-agree="no">Not yet</);
});

test('demo mode: the unclear case shows the question; the default and an existing job do not', async () => {
  const demo = await import('../lib/demo.js');
  assert.equal(demo.leadProposal('', 'unclear').fields.agree.state, 'ask');
  assert.equal(demo.leadProposal('', '').fields.agree, undefined);
  assert.equal(demo.leadProposal('', 'existing').fields.agree, undefined);
});

// Which job: found automatically by default; the dropdown only when you untick it; asked after the reading when unclear.
test('the first form finds the job automatically by default; unticking shows the job list and uses your pick', async () => {
  const fs = await import('node:fs');
  const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
  const compose = html.slice(html.indexOf('<div id="lead-compose">'), html.indexOf('<div id="lead-confirm"'));
  assert.match(compose, /<input type="checkbox" id="lead-auto" checked>\s*<span><span>Find the job automatically \(an existing one, or a new one\)</);
  assert.match(compose, /<div id="lead-target-box" hidden>[\s\S]*<select id="lead-target">/);
  assert.equal(lead.targetOf(true, 'https://x.test/1'), '');  // ticked: Claude finds it
  assert.equal(lead.targetOf(false, 'https://x.test/1'), 'https://x.test/1');
  assert.equal(lead.targetOf(false, 'new'), 'new');
  assert.equal(lead.targetOf(false, ''), '');  // none chosen yet: the dialog asks you to choose
  const js = fs.readFileSync(new URL('../renderer/pages/jobs.js', import.meta.url), 'utf8');
  const openFor = js.slice(js.indexOf('export function openLogFor'), js.indexOf('\n}\n', js.indexOf('export function openLogFor')));
  assert.match(openFor, /setAuto\(false\)[\s\S]*\$\('lead-target'\)\.value = url/);  // Focus → Add details: that job, preselected
});

const unsure = {...pitch, new: true, target: '', fields: {job: {value: '', state: 'ask', question: 'Which job is this?', candidates: [
  {url: 'https://x.test/1', label: 'Example Talent · Senior SRE', stage: 'Recruiter lead'},
  {url: 'https://x.test/2', label: 'Example Talent · Platform Engineer', stage: 'Applied'}]}, ...pitch.fields}};

test('"Which job is this?" is asked first when the match is unclear; the rest waits for the pick', () => {
  const state = lead.initial(unsure);
  assert.ok(lead.choosingJob(unsure, state));
  assert.deepEqual(lead.pending(unsure, state), [{name: 'job', why: 'empty'}]);
  assert.equal(lead.saveLabel(lead.pending(unsure, state)), 'Confirm 1 detail');
  const choices = lead.jobChoices(unsure.fields.job.candidates, [
    {url: 'https://x.test/2', company: 'Example Talent', title: 'Platform Engineer', stage: 'Applied'},
    {url: 'https://x.test/3', company: 'Globex', title: 'SRE', stage: 'Screening'},
    {url: 'https://x.test/4', company: 'Old', title: 'SRE', stage: 'Closed'}]);
  assert.deepEqual(choices, [
    {group: 'Possible matches', options: [{value: 'https://x.test/1', text: 'Example Talent · Senior SRE (Recruiter lead)'},
      {value: 'https://x.test/2', text: 'Example Talent · Platform Engineer (Applied)'}]},
    {options: [{value: 'new', text: 'A new job (not in my list yet)'}]},
    {group: 'Your other applications', options: [{value: 'https://x.test/3', text: 'Globex · SRE (Screening)'}]}]);
});

test('a clear match asks nothing about the job; Change opens the question, and your details carry over to the pick', () => {
  let state = lead.initial(pitch);
  assert.ok(!lead.choosingJob(pitch, state));
  assert.ok(!lead.pending(pitch, state).some(p => p.name === 'job'));
  state = lead.set(state, 'company', 'Example Robotics GmbH');
  assert.deepEqual(lead.pending(pitch, {...state, picking: true}), [{name: 'job', why: 'empty'}]);
  const next = {...pitch, new: false, stage: 'Recruiter lead', fields: {...pitch.fields, company: undefined, agency: undefined,
    channel: {value: 'LinkedIn', state: 'check', guess: 'LinkedIn'}}};
  const carried = lead.carry(lead.set(state, 'channel', 'Email'), next);
  assert.equal(carried.values.channel, 'Email');
  assert.ok(carried.confirmed.includes('channel'));
  assert.equal(carried.first, '');  // a tracked job: no "first contact" question
  assert.ok(!carried.picking);
});

test('demo mode: "which" asks the job first; picking one proposes it without the question', async () => {
  const demo = await import('../lib/demo.js');
  assert.equal(demo.leadProposal('', 'which').fields.job.candidates.length, 2);
  assert.equal(demo.leadProposal('https://demo.example/jobs/1', 'which').fields.job, undefined);
});

// Laelaps AI (30 Sep 2026): applied on TechTree 26 Sep as an Outbound manual add; the LinkedIn chat began 11 Sep.
const laelaps = {new: false, stage: 'Rejected', label: 'Laelaps AI — Infrastructure Engineer', first_known: '2026-09-26T15:00:00+00:00',
  current: {Origin: 'Outbound', Source: 'Manual', 'Reached via': '', Stage: 'Rejected'}, fields: {
    kind: {value: 'Update on this job', state: 'ok'}, channel: {value: 'LinkedIn', state: 'ok', guess: 'LinkedIn'},
    started: {value: '2026-09-11', state: 'ok'},
    origin: {value: '', state: 'ask', required: false, question: 'Who reached out first?', current: 'Outbound', first_known: '2026-09-26T15:00:00+00:00'}}};

test('who reached out first is asked only once the day you confirmed is before the first contact', () => {
  const state = lead.initial(laelaps);
  assert.deepEqual(lead.pending(laelaps, state).map(p => `${p.name}:${p.why}`), ['origin:empty']);
  assert.equal(lead.originShown(laelaps, state), true);
  const later = lead.set(state, 'started', '2026-09-28');  // after the application: nothing to ask
  assert.equal(lead.originShown(laelaps, later), false);
  assert.deepEqual(lead.pending(laelaps, later), []);
  const unknown = lead.set(state, 'started', '');  // the year isn't answered yet: not asked yet
  assert.equal(lead.originShown(laelaps, unknown), false);
  assert.deepEqual(lead.pending(laelaps, lead.set(state, 'origin', 'inbound')), []);
});

test('your answer goes to the engine only when the question was shown', () => {
  const answered = lead.set(lead.initial(laelaps), 'origin', 'inbound');
  assert.equal(lead.confirmed(laelaps, answered).origin, 'inbound');
  assert.equal('origin' in lead.confirmed(laelaps, lead.set(answered, 'started', '2026-09-28')), false);
  assert.equal('origin' in lead.confirmed({...laelaps, fields: {...laelaps.fields, origin: undefined}}, lead.initial(laelaps)), false);
});

test('the "This will change" box lists only values a save replaces, with the funnel effect of Origin', () => {
  const inbound = lead.set(lead.initial(laelaps), 'origin', 'inbound');
  assert.deepEqual(lead.changes(laelaps, inbound).map(c => `${c.name}: ${c.from} → ${c.to}`),
    ['Origin: Outbound → Inbound', 'Source: Manual → LinkedIn']);
  assert.match(lead.changes(laelaps, inbound)[0].note, /application funnel/);
  assert.deepEqual(lead.changes(laelaps, lead.set(lead.initial(laelaps), 'origin', 'outbound')).map(c => c.name), ['Source']);
  assert.deepEqual(lead.changes(laelaps, lead.set(inbound, 'started', '2026-09-28')), []);  // a later conversation changes neither
  assert.deepEqual(lead.changes({...laelaps, current: {...laelaps.current, Source: 'LinkedIn'}}, lead.set(lead.initial(laelaps), 'origin', 'outbound')), []);
  assert.deepEqual(lead.changes({...chat}, lead.initial(chat)), []);  // a new job replaces nothing
});

test('a stage a save moves the job to is listed too', () => {
  const applied = {...laelaps, current: {...laelaps.current, Stage: 'Applied'}, stage: 'Applied'};
  const rejected = lead.set(lead.set(lead.initial(applied), 'kind', 'Rejected'), 'started', '2026-09-28');
  assert.deepEqual(lead.changes(applied, rejected).map(c => `${c.name}: ${c.from} → ${c.to}`), ['Stage: Applied → Rejected']);
});

test('the answer to who reached out first is sent as --origin', async () => {
  const {confirmedArgs} = await import('../lib/pipeline.js');
  assert.deepEqual(confirmedArgs({channel: 'LinkedIn', started: '2026-09-11', firstContact: null, origin: 'inbound'}),
    ['--channel', 'LinkedIn', '--started', '2026-09-11', '--origin', 'inbound']);
  assert.equal(confirmedArgs({channel: 'LinkedIn', started: '2026-09-11', firstContact: null}).includes('--origin'), false);
});

test('the question says which two days it compares, in short form', () => {
  const state = lead.initial(laelaps);
  assert.equal(lead.originHint(laelaps.fields.origin, state),
    "Your conversation on LinkedIn (11 Sep) came before this job's first contact (26 Sep). If they wrote first, it counts as inbound.");
  assert.match(lead.originHint(laelaps.fields.origin, lead.set(state, 'origin', 'inbound')), /Counted as inbound\.$/);
});
