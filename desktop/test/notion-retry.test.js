// Every Notion call waits and retries when Notion is busy (429) or briefly down (502/503/504): a busy moment once
// left a form without the owner's name, because the contact read failed on the first 429.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as notion from '../lib/notion.js';

test('a 429 is retried after Retry-After, then the answer is returned', async () => {
  const waits = [];
  notion.useSleep(async ms => { waits.push(ms); });
  let calls = 0;
  const fetcher = async () => (++calls < 3
    ? {ok: false, status: 429, headers: {get: name => (name === 'retry-after' ? '2' : null)}, json: async () => ({message: 'rate limited'})}
    : {ok: true, status: 200, json: async () => ({results: ['ok']})});
  assert.deepEqual(await notion.call('t', 'GET', 'blocks/x/children', null, fetcher), {results: ['ok']});
  assert.deepEqual(waits, [2000, 2000]);
});

test('without Retry-After it backs off; it gives up after its retries; other errors fail at once', async () => {
  const waits = [];
  notion.useSleep(async ms => { waits.push(ms); });
  const busy = async () => ({ok: false, status: 503, json: async () => ({})});
  await assert.rejects(notion.call('t', 'GET', 'pages/x', null, busy), error => error.status === 503);
  assert.deepEqual(waits, [500, 1000, 2000, 4000]);
  waits.length = 0;
  const missing = async () => ({ok: false, status: 404, json: async () => ({message: 'Could not find page'})});
  await assert.rejects(notion.call('t', 'GET', 'pages/x', null, missing), /Could not find page/);
  assert.deepEqual(waits, []);
  await assert.rejects(notion.call('t', 'GET', 'pages/x', null, busy, {retries: 0}), error => error.status === 503);
  assert.deepEqual(waits, []);
});
