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
