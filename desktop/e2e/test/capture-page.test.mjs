// Capturing a page (lib/capture-page.mjs): nothing personal survives the scrub; the person's own values are found in the app's files.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
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
