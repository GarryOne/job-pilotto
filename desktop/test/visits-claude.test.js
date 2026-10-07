// "Read with Claude" (7 Oct 2026): the session's instructions keep the rules: the user's search, every page saved through the app's own
// reader, at most 20 pages, never Apply / Sign in / a check (it stops and asks).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readPrompt} from '../lib/claude-session.js';

test('a Read with Claude session reads through the app and never applies, signs in or answers a check', () => {
  const text = readPrompt('https://www.rolex.com/careers', 'Rolex', '/tmp/x/read_ab12.json');
  assert.match(text, /python3 -m src\.desktop visit-context \/tmp\/x\/read_ab12\.json/, 'the search comes from the app');
  assert.match(text, /python3 -m src\.desktop visit-read/, 'each page goes through the same reader as the extension');
  assert.match(text, /at most 20 pages/);
  assert.match(text, /Never click Apply, Easy Apply, Submit/);
  assert.match(text, /never sign in, never answer a CAPTCHA/);
  assert.match(text, /tools\/notify\.sh https:\/\/www\.rolex\.com\/careers/, 'a check: the person is told');
});

test('one session can read several stopped sites in turn, each saved as its own site, with the same never-press rules', async () => {
  const {readManyPrompt} = await import('../lib/claude-session.js');
  const text = readManyPrompt([{url: 'https://www.hublot.com/en-ch/job-offers', name: 'Hublot'}, {url: 'https://www.iwc.com', name: 'IWC'}], '/tmp/x/read_ab12cd34.json');
  assert.match(text, /1\. Hublot: https:\/\/www\.hublot\.com\/en-ch\/job-offers \(session "read_ab12cd34_1\.json", start "https:\/\/www\.hublot\.com\/en-ch\/job-offers"\)/);
  assert.match(text, /2\. IWC: https:\/\/www\.iwc\.com \(session "read_ab12cd34_2\.json"/);
  assert.match(text, /Never click Apply/);
  assert.match(text, /never ask a question or wait for a reply/);
});
