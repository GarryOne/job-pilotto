// Capturing a page (lib/capture-page.mjs): nothing personal survives the scrub; the person's own values are found in the app's files.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {scrub as scrubLive} from '../../lib/live-capture.js';
import {FAKE, personalValues, scrub, writeCapture} from '../lib/capture-page.mjs';

test('emails but example.*, phone numbers and the person\'s own name and email are replaced', () => {
  const values = personalValues(['# Profile\nName: Ana Maria Popescu\nEmail: ana.popescu@gmail.com\nPhone: +41 79 555 12 34']);
  const html = '<p>Welcome back, Ana Popescu (ana.popescu@gmail.com, +41 79 555 12 34). Write to jobs@example.com.</p>';
  const out = scrub(html, values);
  assert.ok(!/ana|popescu|gmail|555/i.test(out), out);
  assert.match(out, /jobs@example\.com/);
  assert.ok(out.includes(FAKE.email) && out.includes(FAKE.name) && out.includes(FAKE.phone));
});

test('a capture is written into its case folder and listed in case.json without its query', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-capture-'));
  writeCapture({out, caseName: 'email-first-signup-1', pageName: 'login', url: 'https://auth.example.org/u/login/identifier?state=SECRET#x', html: '<p>x</p>'});
  writeCapture({out, caseName: 'email-first-signup-1', pageName: 'login', url: 'https://auth.example.org/u/login/identifier', html: '<p>y</p>'});
  const item = JSON.parse(fs.readFileSync(path.join(out, 'email-first-signup-1', 'case.json'), 'utf8'));
  assert.deepEqual(item.pages, [{url: 'https://auth.example.org/u/login/identifier', file: 'login.html'}]);
  assert.equal(fs.readFileSync(path.join(out, 'email-first-signup-1', 'login.html'), 'utf8'), '<p>y</p>');
});

test('the page capture and the live sketch scrub an email and a phone the same way: a replay of the page sends the sketch the live run sent', () => {
  for (const email of ['jobs@hornbach.example.com', 'ana.popescu@gmail.com', 'hr@firma.ch', 'jobs@example.com', 'talent@example.org', '+41 79 555 12 34', '079 555 12 34', 'Ref 2026-10-11']) {
    assert.equal(scrub(`Mail ${email} now`), scrubLive(`Mail ${email} now`), email);
  }
});

test('a name word is scrubbed, an acronym that spells it is not (the fake applicant "Ada" and "the Americans with Disabilities Act (ADA)")', () => {
  const values = personalValues(['Name: Ada Tester']);
  const out = scrub('<p>Hello Ada, ada tester here. The Americans with Disabilities Act (ADA) applies.</p>', values);
  assert.match(out, /\(ADA\)/);
  assert.doesNotMatch(out, /Hello Ada|ada tester/i);
});

test('a long number that is part of an identifier (Greenhouse question_4553828006) is no phone: ids and labels stay linked; a real phone is still scrubbed', () => {
  const html = '<label for="question_4553828006">Legal Address</label><input id="question_4553828006"><p>Call +41 79 555 12 34 or 0795551234.</p>';
  const out = scrub(html);
  assert.match(out, /for="question_4553828006"/);
  assert.match(out, /id="question_4553828006"/);
  assert.doesNotMatch(out, /555 12 34|0795551234/);
});
