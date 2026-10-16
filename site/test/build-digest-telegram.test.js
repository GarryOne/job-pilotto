// The Build Log Telegram post (src/build-digest-telegram.js): HTML, split under the limit, escaped, skipped without a token, once. No live Telegram: fetch is a fake.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {messages, post} from '../src/build-digest-telegram.js';

const digest = {day: '2026-10-16', numbers: [957, 959, 960, 1081], open: 'The bot <token>.', groups: [{emoji: '🧭', title: 'Apply & fill', bullets: [{lead: 'Radio groups', text: 'A radio question is named by its own question.', prs: [957, 958, 959]}]}]};
const fake = (status = 200) => { const calls = []; return {calls, fetch: async (url, init) => { calls.push({url, body: JSON.parse(init.body)}); return {ok: status === 200, status}; }}; };

test('one message with the intro, bold groups, PR ranges and the open line; HTML is escaped', () => {
  const [text, ...rest] = messages(digest);
  assert.equal(rest.length, 0);
  assert.match(text, /^Here's what we achieved on 16 Oct, grouped by goal\. About 4 PRs merged, from #957 to #1081\./);
  assert.match(text, /🧭 <b>Apply &amp; fill<\/b>\n• <b>Radio groups\.<\/b> A radio question is named by its own question\. \(#957-#959\)/);
  assert.match(text, /<b>Still open:<\/b> The bot &lt;token&gt;\.$/);
});

test('a long digest is split at group boundaries, every message under Telegram\'s 4096 characters', () => {
  const many = {...digest, groups: Array.from({length: 9}, (_, i) => ({emoji: '🧪', title: `Goal ${i}`, bullets: Array.from({length: 5}, (_, k) => ({lead: `Lead ${k}`, text: 'x'.repeat(240), prs: [957 + k]}))}))};
  const list = messages(many);
  assert.ok(list.length >= 2);
  assert.ok(list.every(text => text.length <= 4096));
  assert.ok(list.every(text => (text.match(/<b>/g) || []).length === (text.match(/<\/b>/g) || []).length), 'no tag is cut in half');
  assert.match(list.at(-1), /Still open/);
});

test('post: sends every message to the chat as HTML; no token or chat skips; an error names the status only', async () => {
  const ok = fake();
  assert.deepEqual(await post(digest, {token: 'T0K', chat: '-100', fetch: ok.fetch}), {sent: 1});
  assert.equal(ok.calls[0].url, 'https://api.telegram.org/botT0K/sendMessage');
  assert.deepEqual([ok.calls[0].body.chat_id, ok.calls[0].body.parse_mode], ['-100', 'HTML']);
  const none = fake();
  assert.match((await post(digest, {token: '', chat: '-100', fetch: none.fetch})).skipped, /not set/);
  assert.equal(none.calls.length, 0);
  await assert.rejects(post(digest, {token: 'SECRET', chat: '-100', fetch: fake(401).fetch}), error => /401/.test(error.message) && !/SECRET/.test(error.message));
});
