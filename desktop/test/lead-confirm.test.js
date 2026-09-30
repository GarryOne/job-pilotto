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
