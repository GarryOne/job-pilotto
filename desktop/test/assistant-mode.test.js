// The assistant mode (renderer/assistant-mode.js): two choices, "Do it for me" by default; each says what it does and what it never does.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {MODE_TEXT, modeOfSettings} from '../renderer/assistant-mode.js';

test('two modes only, "Do it for me" unless the person chose to check each step', () => {
  assert.deepEqual(Object.keys(MODE_TEXT), ['full', 'assist']);
  assert.equal(modeOfSettings({}), 'full');
  assert.equal(modeOfSettings({accountAutomation: 'assist'}), 'assist');
  assert.equal(modeOfSettings({accountAutomation: 'nonsense'}), 'full');
});

test('each mode names what is never automated: an application\'s Submit and a captcha in both; the SMS code never', () => {
  for (const text of Object.values(MODE_TEXT)) assert.match(text, /Never: an application's Submit, a captcha or bot check/);
  assert.match(MODE_TEXT.full, /confirmation link from your email when Gmail is connected/);
  assert.match(MODE_TEXT.full, /an SMS code/);
  assert.match(MODE_TEXT.full, /a screenshot to the AI, what you typed hidden, at most 10 a day/);
});
