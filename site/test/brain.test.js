// The product brain's Telegram buttons (src/brain.js): only the owner's chat, only with the webhook secret; a tap
// starts product-brain.yml with the step and the decision's id, and the pressed button stays as the record.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {brain} from '../src/brain.js';

const env = {BRAIN_BOT_TOKEN: 't', BRAIN_WEBHOOK_SECRET: 's3cret', BRAIN_CHAT_ID: '42'};
const id = 'a'.repeat(32);
const tap = (data, chat = 42, secret = 's3cret') => new Request('https://www.jobpilotto.top/api/brain/telegram', {
  method: 'POST', headers: {'X-Telegram-Bot-Api-Secret-Token': secret},
  body: JSON.stringify({callback_query: {id: 'q', data, message: {chat: {id: chat}, message_id: 7}}})});

function fakes() {
  const dispatched = [], telegram = [];
  return {dispatched, telegram, dispatch: async (e, inputs, workflow) => dispatched.push({inputs, workflow}),
    fetcher: async (url, init) => { telegram.push({method: url.split('/').pop(), body: JSON.parse(init.body)}); return new Response('{}'); }};
}

test('Explore starts the explore step for that decision and freezes the buttons', async () => {
  const f = fakes();
  await brain(tap(`pb:x:${id}`), env, f.dispatch, f.fetcher);
  assert.deepEqual(f.dispatched, [{inputs: {step: 'explore', id}, workflow: 'product-brain.yml'}]);
  assert.equal(f.telegram[0].method, 'editMessageReplyMarkup');
  assert.equal(f.telegram[0].body.reply_markup.inline_keyboard[0][0].text, '✅ Exploring…');
  assert.equal(f.telegram[1].method, 'answerCallbackQuery');
});

test('every button maps to its step', async () => {
  for (const [code, step] of [['n', 'skip'], ['a', 'another'], ['ok', 'approve']]) {
    const f = fakes();
    await brain(tap(`pb:${code}:${id}`), env, f.dispatch, f.fetcher);
    assert.equal(f.dispatched[0].inputs.step, step);
  }
});

test('a wrong secret or another chat starts nothing', async () => {
  const f = fakes();
  assert.equal((await brain(tap(`pb:x:${id}`, 42, 'nope'), env, f.dispatch, f.fetcher)).status, 404);
  await brain(tap(`pb:x:${id}`, 99), env, f.dispatch, f.fetcher);
  assert.equal(f.dispatched.length, 0);
});

test('a failed dispatch is said in Telegram, not swallowed', async () => {
  const f = fakes();
  await brain(tap(`pb:x:${id}`), env, async () => { throw new Error('GitHub dispatch failed: 403'); }, f.fetcher);
  assert.match(f.telegram.at(-1).body.text, /403/);
  assert.equal(f.telegram.at(-1).body.show_alert, true);
});

test('with BRAIN_REPO and BRAIN_GITHUB_TOKEN, the tap starts the workflow in the private brain repo', async () => {
  const seen = [];
  const f = fakes();
  await brain(tap(`pb:x:${id}`), {...env, GITHUB_REPO: 'GarryOne/job-pilotto', GITHUB_TOKEN: 'public',
    BRAIN_REPO: 'GarryOne/job-pilotto-internal', BRAIN_GITHUB_TOKEN: 'ops'}, async (e) => seen.push([e.GITHUB_REPO, e.GITHUB_TOKEN]), f.fetcher);
  assert.deepEqual(seen, [['GarryOne/job-pilotto-internal', 'ops']]);
});
