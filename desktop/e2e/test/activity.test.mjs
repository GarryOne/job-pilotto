// The checks the activity suite applies to a run's words: they must flag what they claim to, and let a good line through.
import assert from 'node:assert/strict';
import test from 'node:test';
import {badSummary, leaks} from '../lib/activity.mjs';

test('a good summary line passes', () => {
  for (const line of ['3 new jobs', 'nothing new', 'Gmail not connected (Settings → Gmail and Calendar)', 'Your Anthropic API spending limit was reached, so 2 jobs weren\'t scored.']) assert.equal(badSummary(line), '');
});
test('an empty, programming-value, JSON or stack-trace summary is flagged', () => {
  assert.match(badSummary(''), /empty/);
  assert.match(badSummary(undefined), /empty/);
  assert.match(badSummary('Insight: undefined'), /programming value/);
  assert.match(badSummary('[object Object]'), /programming value/);
  assert.match(badSummary('{"error":{"type":"rate_limit_error"}}'), /raw JSON/);
  assert.match(badSummary('Traceback (most recent call last):'), /stack trace/);
  assert.match(badSummary('anthropic.AuthenticationError: invalid x-api-key'), /stack trace/);
});
test('a log with a key, a token, an email or a home path is flagged; a clean one is not', () => {
  assert.deepEqual(leaks('Checked 4 feeds; 2 new jobs\nScored Senior SRE (82)'), []);
  assert.match(leaks('using key sk-ant-api03-AbCdEfGh123456')[0], /Anthropic key/);
  assert.match(leaks('token ntn_abcdefghijkl1234')[0], /Notion token/);
  assert.match(leaks('chat 123456789:AAAbbbCCCdddEEEfffGGGhhhIIIjjjKKK12')[0], /Telegram/);
  assert.match(leaks('mail from igor@gmail.com')[0], /email/);
  assert.match(leaks('wrote /Users/mac/Library/x.json')[0], /home folder/);
  assert.match(leaks('wrote C:\\Users\\igor\\x.json')[0], /home folder/);
  assert.match(leaks('data in /var/folders/zz/jp-e2e-abc/data', {dirs: ['/var/folders/zz/jp-e2e-abc']})[0], /path on this computer/);
  assert.match(leaks('the value hunter2hunter2 leaked', {secrets: ['hunter2hunter2']})[0], /saved secret/);
});
test('the saved secret is never repeated in the finding', () => {
  assert.ok(!leaks('the value hunter2hunter2 leaked', {secrets: ['hunter2hunter2']}).join().includes('hunter2hunter2'));
});
