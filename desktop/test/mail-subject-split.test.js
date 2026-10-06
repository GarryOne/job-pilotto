// An email line on a Gmail check's page is "subject · sender · time — [action] …" (src/notion/cron_runs.py email_lines). A subject
// with " · " in it ("Update on your application · Orbit Labs") was cut at its first part, so it no longer matched its Focus question
// and the card drew an open "which job?" as answered: "1 needs your answer" for 3 (6 Oct 2026). Read from the right.
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMailLines} from '../renderer/mail-report.js';

const line = head => `${head} — [needs you] · Orbit Labs`;
const emailOf = head => parseMailLines(['Gmail check: 1 new email(s) read, 0 update(s) recorded', line(head)]).emails[0];

test('a subject with " · " in it stays whole; the sender and the time are the last two parts', () => {
  const email = emailOf('Update on your application · Orbit Labs Talent Team · orbitlabs.example · 05 Oct 11:20');
  assert.deepEqual([email.subject, email.sender, email.time], ['Update on your application · Orbit Labs Talent Team', 'orbitlabs.example', '05 Oct 11:20']);
});

test('the usual three parts, and a line without a time, read as before', () => {
  const plain = emailOf('Re: next steps · Jordan Lee · 05 Oct 16:20');
  assert.deepEqual([plain.subject, plain.sender, plain.time], ['Re: next steps', 'Jordan Lee', '05 Oct 16:20']);
  const short = emailOf('Re: next steps · Jordan Lee');
  assert.deepEqual([short.subject, short.sender, short.time], ['Re: next steps', 'Jordan Lee', '']);
});
