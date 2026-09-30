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
