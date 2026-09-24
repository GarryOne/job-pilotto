import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker, { afterAction, formatApplied, formatSaved, parseCommand, withActionRow } from '../src/index.js';

const env = {
  TELEGRAM_BOT_TOKEN: 'tg', OWNER_CHAT_ID: '42', WEBHOOK_SECRET: 's3cret', GITHUB_TOKEN: 'gh',
  NOTION_TOKEN: 'nt', GITHUB_REPO: 'owner/repo', WORKFLOW_FILE: 'daily.yml', NOTION_APPLICATIONS_DB: 'db1',
};

// Replace fetch with a recorder; respond by URL.
function mockFetch(responses = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : null, headers: init.headers });
    const key = Object.keys(responses).find((k) => url.includes(k));
    const r = key ? responses[key] : { status: 200, json: { ok: true } };
    return new Response(r.status === 204 ? null : JSON.stringify(r.json ?? {}), { status: r.status ?? 200 });
  };
  return calls;
}

async function send(text, { chatId = 42, secret = 's3cret' } = {}) {
  const pending = [];
  const request = new Request('https://bot.test/telegram', {
    method: 'POST',
    headers: { 'X-Telegram-Bot-Api-Secret-Token': secret },
    body: JSON.stringify({ message: { chat: { id: chatId }, text } }),
  });
  const response = await worker.fetch(request, env, { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  return response;
}

test('parses commands, codes and bot suffixes', () => {
  assert.deepEqual(parseCommand('/apply_AB12cd34@job_pilotto_bot'), { name: 'apply', arg: 'ab12cd34' });
  assert.deepEqual(parseCommand('/run'), { name: 'run', arg: '' });
  assert.equal(parseCommand('hello'), null);
});

test('rejects requests without the webhook secret', async () => {
  const calls = mockFetch();
  const response = await send('/run', { secret: 'wrong' });
  assert.equal(response.status, 403);
  assert.equal(calls.length, 0);
});

test('ignores chats other than the owner', async () => {
  const calls = mockFetch();
  assert.equal((await send('/run', { chatId: 7 })).status, 200);
  assert.equal(calls.length, 0);
});

test('/apply_<code> dispatches the workflow and confirms', async () => {
  const calls = mockFetch({ '/dispatches': { status: 204 } });
  await send('/apply_ab12cd34');
  assert.match(calls[0].url, /repos\/owner\/repo\/actions\/workflows\/daily\.yml\/dispatches$/);
  assert.deepEqual(calls[0].body, { ref: 'main', inputs: { mode: 'apply', job: 'ab12cd34' } });
  assert.equal(calls[1].body.chat_id, '42');
  assert.match(calls[1].body.text, /Marking it applied/);
});

async function tap(data, { chatId = 42, markup } = {}) {
  const pending = [];
  const request = new Request('https://bot.test/telegram', {
    method: 'POST',
    headers: { 'X-Telegram-Bot-Api-Secret-Token': 's3cret' },
    body: JSON.stringify({ callback_query: { id: 'q1', data,
      message: { chat: { id: chatId }, message_id: 9, reply_markup: markup } } }),
  });
  await worker.fetch(request, env, { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
}

const digestMarkup = { inline_keyboard: [
  [{ text: '1', callback_data: 'pick:ab12cd34:1' }, { text: '2', callback_data: 'pick:cd34ef56:2' }],
  [{ text: '➕ Next 10', callback_data: 'more:7:2' }]] };

test('tapping a number adds an action row for that job', async () => {
  const calls = mockFetch();
  await tap('pick:cd34ef56:2', { markup: digestMarkup });
  assert.match(calls[0].url, /editMessageReplyMarkup$/);
  const rows = calls[0].body.reply_markup.inline_keyboard;
  assert.deepEqual(rows[0].map((b) => b.callback_data), ['act:a:cd34ef56:2', 'act:s:cd34ef56:2', 'act:d:cd34ef56:2', 'close']);
  assert.deepEqual(rows[1].map((b) => b.callback_data), ['act:p:cd34ef56:2']);
  assert.equal(rows.length, 4);
});

test('Prepare dispatches a prepare run and marks the number', async () => {
  const calls = mockFetch({ '/dispatches': { status: 204 } });
  await tap('act:p:cd34ef56:2', { markup: withActionRow(digestMarkup, 'cd34ef56', 2) });
  assert.deepEqual(calls[0].body, { ref: 'main', inputs: { mode: 'prepare', job: 'cd34ef56' } });
  const rows = calls[1].body.reply_markup.inline_keyboard;
  assert.equal(rows.length, 2);  // both action rows removed
  assert.equal(rows[0][1].text, '📝 2');
  assert.match(calls[2].body.text, /application kit/);
});

test('Save dispatches a saved action and stars the number', async () => {
  const calls = mockFetch({ '/dispatches': { status: 204 } });
  await tap('act:s:cd34ef56:2', { markup: withActionRow(digestMarkup, 'cd34ef56', 2) });
  assert.deepEqual(calls[0].body, { ref: 'main', inputs: { mode: 'apply', job: 'cd34ef56', action: 'saved' } });
  const rows = calls[1].body.reply_markup.inline_keyboard;
  assert.equal(rows.length, 2);  // action row removed
  assert.equal(rows[0][1].text, '⭐ 2');
  assert.match(calls[2].url, /answerCallbackQuery$/);
});

test('Dismiss and Applied map to their actions', () => {
  assert.equal(afterAction(digestMarkup, 1, '❌').inline_keyboard[0][0].text, '❌ 1');
});

test('/saved lists saved jobs', () => {
  assert.match(formatSaved([], 'x'), /No saved jobs/);
  const page = { properties: { Job: { title: [{ plain_text: 'SRE' }] }, Company: { rich_text: [{ plain_text: 'Acme' }] },
    'Job URL': { url: 'https://x.test/1' } } };
  assert.match(formatSaved([page], 'https://n.test'), /Saved jobs<\/b> \(1\)/);
});

test('legacy ✅ button dispatches apply and answers the tap', async () => {
  const calls = mockFetch({ '/dispatches': { status: 204 } });
  await tap('apply:ab12cd34');
  assert.deepEqual(calls[0].body, { ref: 'main', inputs: { mode: 'apply', job: 'ab12cd34', action: 'applied' } });
  assert.match(calls[1].url, /answerCallbackQuery$/);
  assert.equal(calls[1].body.callback_query_id, 'q1');
});

test('➕ Next button dispatches the next page with the same seed', async () => {
  const calls = mockFetch({ '/dispatches': { status: 204 } });
  await tap('more:123456:2');
  assert.deepEqual(calls[0].body, { ref: 'main', inputs: { mode: 'more', seed: '123456', page: '2' } });
  assert.match(calls[1].body.text, /next jobs/);
});

test('buttons from other chats are ignored', async () => {
  const calls = mockFetch();
  await tap('apply:ab12cd34', { chatId: 7 });
  assert.equal(calls.length, 0);
});

test('invalid apply code is not dispatched', async () => {
  const calls = mockFetch();
  await send('/apply_zz');
  assert.equal(calls.length, 1);
  assert.match(calls[0].body.text, /Tap the/);
});

test('dispatch failure is reported to the owner', async () => {
  const calls = mockFetch({ '/dispatches': { status: 401, json: { message: 'Bad credentials' } } });
  await send('/run');
  assert.match(calls.at(-1).body.text, /⚠️ GitHub dispatch failed: 401/);
});

test('/applied queries Notion and formats rows', async () => {
  const page = { properties: {
    Job: { title: [{ plain_text: 'SRE <Zurich>' }] }, Company: { rich_text: [{ plain_text: 'Acme' }] },
    Stage: { select: { name: 'Interview scheduled' } }, 'Applied on': { date: { start: '2026-09-24' } },
    'Next interview': { date: { start: '2026-10-01T10:00:00.000+02:00' } }, 'Job URL': { url: 'https://x.test/1' },
  } };
  const calls = mockFetch({ 'api.notion.com': { json: { results: [page] } } });
  await send('/applied');
  assert.deepEqual(calls[0].body.filter.and.map((f) => f.select.does_not_equal), ['Saved', 'Dismissed']);
  const text = calls[1].body.text;
  assert.match(text, /Applications<\/b> \(1\)/);
  assert.match(text, /SRE &lt;Zurich&gt;/);
  assert.match(text, /🗓 Interview scheduled · 📅 applied 2026-09-24 · 🗓 2026-10-01T10:00/);
});

test('/scout dispatches the scout workflow', async () => {
  const calls = mockFetch({ '/dispatches': { status: 204 } });
  await send('/scout');
  assert.match(calls[0].url, /actions\/workflows\/scout\.yml\/dispatches$/);
  assert.deepEqual(calls[0].body, { ref: 'main', inputs: { batch: '15' } });
});

test('empty applications list points to Notion', () => {
  assert.match(formatApplied([], 'https://notion.test/db'), /No applications yet/);
});
