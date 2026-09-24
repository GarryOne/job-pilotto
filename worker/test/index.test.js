import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker, { formatApplied, parseCommand } from '../src/index.js';

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
  assert.deepEqual(parseCommand('/apply_AB12cd34@swiss_sre_watch_bot'), { name: 'apply', arg: 'ab12cd34' });
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

async function tap(data, { chatId = 42 } = {}) {
  const pending = [];
  const request = new Request('https://bot.test/telegram', {
    method: 'POST',
    headers: { 'X-Telegram-Bot-Api-Secret-Token': 's3cret' },
    body: JSON.stringify({ callback_query: { id: 'q1', data, message: { chat: { id: chatId } } } }),
  });
  await worker.fetch(request, env, { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
}

test('✅ button dispatches apply and answers the tap', async () => {
  const calls = mockFetch({ '/dispatches': { status: 204 } });
  await tap('apply:ab12cd34');
  assert.deepEqual(calls[0].body, { ref: 'main', inputs: { mode: 'apply', job: 'ab12cd34' } });
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
  assert.equal(calls[0].body.filter.select.does_not_equal, 'Saved');
  const text = calls[1].body.text;
  assert.match(text, /Applications<\/b> \(1\)/);
  assert.match(text, /SRE &lt;Zurich&gt;/);
  assert.match(text, /🗓 Interview scheduled · 📅 applied 2026-09-24 · 🗓 2026-10-01T10:00/);
});

test('empty applications list points to Notion', () => {
  assert.match(formatApplied([], 'https://notion.test/db'), /No applications yet/);
});
